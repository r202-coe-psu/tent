import { describe, it, expect } from 'vitest';
import {
	computeQuota,
	assertQuotaInvariant,
	applyDispatch,
	applyAccept,
	applyDecline,
	applyRelease,
	deriveJobStatus,
	almostFullCutoff,
	QuotaError,
	type JobQuota
} from './quota';

function baseQuota(overrides: Partial<JobQuota> = {}): JobQuota {
	return { quota: 10, slots_confirmed: 0, slots_dispatched: 0, slots_remaining: 10, ...overrides };
}

describe('computeQuota', () => {
	it('derives confirmed/dispatched/remaining from quota fields', () => {
		expect(computeQuota({ quota: 10, slots_confirmed: 3, slots_dispatched: 2 })).toEqual({
			confirmed: 3,
			dispatched: 2,
			remaining: 5
		});
	});

	it('rejects an already-inconsistent stored job instead of reporting a negative remaining (D9)', () => {
		// confirmed(4) + dispatched(4) = 8 against quota 5 — a corrupt/stale doc.
		// Propagating remaining = -3 would render as a real number in the
		// 3-colour quota bar, so the derivation fails loudly instead.
		expect(() => computeQuota({ quota: 5, slots_confirmed: 4, slots_dispatched: 4 })).toThrow(
			QuotaError
		);
	});

	it('rejects NaN and fractional slot counts (D9)', () => {
		expect(() =>
			computeQuota({ quota: Number.NaN, slots_confirmed: 0, slots_dispatched: 0 })
		).toThrow(QuotaError);
		expect(() => computeQuota({ quota: 10, slots_confirmed: 0.5, slots_dispatched: 0 })).toThrow(
			QuotaError
		);
		expect(() =>
			computeQuota({ quota: 10, slots_confirmed: 0, slots_dispatched: Number.POSITIVE_INFINITY })
		).toThrow(QuotaError);
	});
});

describe('assertQuotaInvariant', () => {
	it('passes when buckets sum to quota', () => {
		expect(() =>
			assertQuotaInvariant({
				quota: 10,
				slots_confirmed: 4,
				slots_dispatched: 1,
				slots_remaining: 5
			})
		).not.toThrow();
	});

	it('throws when buckets do not sum to quota', () => {
		expect(() =>
			assertQuotaInvariant({
				quota: 10,
				slots_confirmed: 4,
				slots_dispatched: 1,
				slots_remaining: 4
			})
		).toThrow(QuotaError);
	});

	it('throws when any bucket is negative', () => {
		expect(() =>
			assertQuotaInvariant({
				quota: 10,
				slots_confirmed: -1,
				slots_dispatched: 1,
				slots_remaining: 10
			})
		).toThrow(QuotaError);
	});

	it('throws when a bucket is non-integer, even if the sum matches quota (F5)', () => {
		expect(() =>
			assertQuotaInvariant({
				quota: 5,
				slots_confirmed: 4,
				slots_dispatched: 0,
				slots_remaining: 0.5
			})
		).toThrow(QuotaError);
		expect(() =>
			assertQuotaInvariant({
				quota: 5,
				slots_confirmed: 4.5,
				slots_dispatched: 0,
				slots_remaining: 0.5
			})
		).toThrow(QuotaError);
	});
});

describe('applyDispatch', () => {
	it('moves remaining -> dispatched and keeps the invariant', () => {
		const next = applyDispatch(baseQuota(), 3);
		expect(next).toEqual({
			quota: 10,
			slots_confirmed: 0,
			slots_dispatched: 3,
			slots_remaining: 7
		});
		expect(() => assertQuotaInvariant(next)).not.toThrow();
	});

	it('rejects dispatching more than remaining', () => {
		expect(() => applyDispatch(baseQuota({ slots_remaining: 2, slots_dispatched: 8 }), 3)).toThrow(
			QuotaError
		);
	});

	it('rejects a non-positive count', () => {
		expect(() => applyDispatch(baseQuota(), 0)).toThrow(QuotaError);
	});

	it('rejects a non-integer count (F5)', () => {
		expect(() => applyDispatch(baseQuota(), 0.5)).toThrow(QuotaError);
	});

	it('rejects a negative count', () => {
		expect(() => applyDispatch(baseQuota(), -1)).toThrow(QuotaError);
	});

	it('does not mutate the input', () => {
		const input = baseQuota();
		const frozen = { ...input };
		applyDispatch(input, 2);
		expect(input).toEqual(frozen);
	});

	it('returns an object that does not alias nested state from a wider input object (F18)', () => {
		// A caller commonly passes the full `Job` doc (which has nested fields
		// like `shift_template.days`) typed down to `JobQuota` — the transition
		// must not shallow-spread that wider object and thereby leak a shared
		// reference into the result.
		const wideJobLike = {
			...baseQuota(),
			shift_template: {
				shift_name: 'morning',
				start_time: '08:00',
				end_time: '12:00',
				days: ['mon']
			}
		};
		const next = applyDispatch(wideJobLike, 1) as JobQuota & {
			shift_template?: { days: string[] };
		};
		expect(next.shift_template).toBeUndefined();
		expect(Object.keys(next).sort()).toEqual(
			['quota', 'slots_confirmed', 'slots_dispatched', 'slots_remaining'].sort()
		);
	});
});

describe('applyAccept', () => {
	it('moves dispatched -> confirmed', () => {
		const dispatched = applyDispatch(baseQuota(), 4);
		const accepted = applyAccept(dispatched, 1);
		expect(accepted).toEqual({
			quota: 10,
			slots_confirmed: 1,
			slots_dispatched: 3,
			slots_remaining: 6
		});
	});

	it('rejects accepting more than dispatched', () => {
		expect(() => applyAccept(baseQuota({ slots_dispatched: 1, slots_remaining: 9 }), 2)).toThrow(
			QuotaError
		);
	});

	it('rejects a non-positive count', () => {
		expect(() => applyAccept(baseQuota({ slots_dispatched: 1, slots_remaining: 9 }), 0)).toThrow(
			QuotaError
		);
	});

	it('rejects a non-integer count (F5)', () => {
		expect(() => applyAccept(baseQuota({ slots_dispatched: 1, slots_remaining: 9 }), 0.5)).toThrow(
			QuotaError
		);
	});

	it('does not mutate the input', () => {
		const input = baseQuota({ slots_dispatched: 4, slots_remaining: 6 });
		const frozen = { ...input };
		applyAccept(input, 2);
		expect(input).toEqual(frozen);
	});
});

describe('applyDecline', () => {
	it('moves dispatched -> remaining', () => {
		const dispatched = applyDispatch(baseQuota(), 4);
		const declined = applyDecline(dispatched, 2);
		expect(declined).toEqual({
			quota: 10,
			slots_confirmed: 0,
			slots_dispatched: 2,
			slots_remaining: 8
		});
	});

	it('rejects declining more than dispatched', () => {
		expect(() => applyDecline(baseQuota(), 1)).toThrow(QuotaError);
	});

	it('rejects a non-positive count', () => {
		expect(() => applyDecline(baseQuota({ slots_dispatched: 4, slots_remaining: 6 }), 0)).toThrow(
			QuotaError
		);
	});

	it('rejects a non-integer count (F5)', () => {
		expect(() => applyDecline(baseQuota({ slots_dispatched: 4, slots_remaining: 6 }), 0.5)).toThrow(
			QuotaError
		);
	});

	it('does not mutate the input', () => {
		const input = baseQuota({ slots_dispatched: 4, slots_remaining: 6 });
		const frozen = { ...input };
		applyDecline(input, 2);
		expect(input).toEqual(frozen);
	});
});

describe('applyRelease', () => {
	it('moves confirmed -> remaining', () => {
		const confirmed = baseQuota({ slots_confirmed: 4, slots_remaining: 6 });
		const released = applyRelease(confirmed, 2);
		expect(released).toEqual({
			quota: 10,
			slots_confirmed: 2,
			slots_dispatched: 0,
			slots_remaining: 8
		});
	});

	it('leaves slots_dispatched untouched', () => {
		const job = baseQuota({ slots_confirmed: 3, slots_dispatched: 4, slots_remaining: 3 });
		const released = applyRelease(job, 1);
		expect(released.slots_dispatched).toBe(4);
	});

	it('rejects releasing more than confirmed', () => {
		expect(() => applyRelease(baseQuota(), 1)).toThrow(QuotaError);
	});

	it('rejects a non-positive count', () => {
		expect(() => applyRelease(baseQuota({ slots_confirmed: 4, slots_remaining: 6 }), 0)).toThrow(
			QuotaError
		);
	});

	it('rejects a non-integer count (F5)', () => {
		expect(() => applyRelease(baseQuota({ slots_confirmed: 4, slots_remaining: 6 }), 0.5)).toThrow(
			QuotaError
		);
	});

	it('does not mutate the input', () => {
		const input = baseQuota({ slots_confirmed: 4, slots_remaining: 6 });
		const frozen = { ...input };
		applyRelease(input, 2);
		expect(input).toEqual(frozen);
	});
});

describe('deriveJobStatus (F7)', () => {
	function job(overrides: Partial<Parameters<typeof deriveJobStatus>[0]> = {}) {
		return {
			status: 'open' as const,
			quota: 10,
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: 10,
			...overrides
		};
	}

	it('stays open while more than the almost_full cutoff is still unfilled', () => {
		// quota 10 -> cutoff 2; 3 remaining is one clear of it
		expect(
			deriveJobStatus(job({ slots_confirmed: 7, slots_dispatched: 0, slots_remaining: 3 }))
		).toBe('open');
	});

	it('becomes almost_full exactly at the cutoff (quota 10 -> 2 remaining)', () => {
		expect(almostFullCutoff(10)).toBe(2);
		expect(
			deriveJobStatus(job({ slots_confirmed: 8, slots_dispatched: 0, slots_remaining: 2 }))
		).toBe('almost_full');
	});

	it('counts dispatched-but-unaccepted slots toward the cutoff', () => {
		// 9 of 10 offered out and awaiting acceptance is not "open" in any useful sense
		expect(
			deriveJobStatus(job({ slots_confirmed: 0, slots_dispatched: 9, slots_remaining: 1 }))
		).toBe('almost_full');
	});

	it.each([
		[2, 1],
		[3, 1],
		[4, 1],
		[5, 1],
		[10, 2]
	])('keeps almost_full reachable at quota %i (cutoff %i)', (quota, cutoff) => {
		expect(almostFullCutoff(quota)).toBe(cutoff);
		expect(
			deriveJobStatus(
				job({
					quota,
					slots_confirmed: quota - cutoff,
					slots_dispatched: 0,
					slots_remaining: cutoff
				})
			)
		).toBe('almost_full');
		// one slot earlier is still open, so the band is genuinely entered, not skipped
		expect(
			deriveJobStatus(
				job({
					quota,
					slots_confirmed: quota - cutoff - 1,
					slots_dispatched: 0,
					slots_remaining: cutoff + 1
				})
			)
		).toBe('open');
	});

	it('becomes full once slots_remaining hits 0, even if not all are confirmed yet', () => {
		expect(
			deriveJobStatus(job({ slots_confirmed: 2, slots_dispatched: 8, slots_remaining: 0 }))
		).toBe('full');
	});

	it('never touches draft', () => {
		expect(deriveJobStatus(job({ status: 'draft', slots_remaining: 0 }))).toBe('draft');
	});

	it('never touches paused', () => {
		expect(
			deriveJobStatus(job({ status: 'paused', slots_confirmed: 10, slots_remaining: 0 }))
		).toBe('paused');
	});

	it('never touches closed', () => {
		expect(deriveJobStatus(job({ status: 'closed', slots_remaining: 0 }))).toBe('closed');
	});

	it('never touches cancelled', () => {
		expect(deriveJobStatus(job({ status: 'cancelled', slots_remaining: 0 }))).toBe('cancelled');
	});

	it('can move back from almost_full to open after a decline frees up slots', () => {
		expect(
			deriveJobStatus(job({ status: 'almost_full', slots_confirmed: 2, slots_remaining: 8 }))
		).toBe('open');
	});

	it('can move back from full to open/almost_full after a decline frees a remaining slot', () => {
		expect(deriveJobStatus(job({ status: 'full', slots_confirmed: 2, slots_remaining: 8 }))).toBe(
			'open'
		);
	});
});

describe('quota invariant across a full transition sequence', () => {
	it('holds after dispatch -> accept -> dispatch -> decline', () => {
		let job = baseQuota();
		job = applyDispatch(job, 5);
		assertQuotaInvariant(job);
		job = applyAccept(job, 3);
		assertQuotaInvariant(job);
		job = applyDispatch(job, 2);
		assertQuotaInvariant(job);
		job = applyDecline(job, 2);
		assertQuotaInvariant(job);
		expect(job).toEqual({ quota: 10, slots_confirmed: 3, slots_dispatched: 2, slots_remaining: 5 });
	});

	it('holds when quota is fully consumed by confirmed volunteers', () => {
		let job = baseQuota({ quota: 3, slots_remaining: 3 });
		job = applyDispatch(job, 3);
		job = applyAccept(job, 3);
		expect(job).toEqual({ quota: 3, slots_confirmed: 3, slots_dispatched: 0, slots_remaining: 0 });
		assertQuotaInvariant(job);
	});
});
