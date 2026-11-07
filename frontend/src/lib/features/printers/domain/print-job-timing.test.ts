import { describe, expect, it } from 'vitest';
import { MAX_LABELS_PER_JOB } from './print-job.schema';
import {
	CLOCK_SKEW_SEC,
	effectiveExpiryMs,
	isCreatedInFuture,
	isPendingExpired,
	JOB_TTL_SEC,
	leaseSecFor,
	PRINT_JOB_POLL_TIMEOUT_MS,
	SWEEP_INTERVAL_SEC
} from './print-job-timing';

describe('leaseSecFor', () => {
	it('grows with the number of labels in the job', () => {
		expect(leaseSecFor(1)).toBe(95);
		expect(leaseSecFor(MAX_LABELS_PER_JOB)).toBe(190);
	});
});

describe('PRINT_JOB_POLL_TIMEOUT_MS', () => {
	it('outlasts the longest a full job can stay open on the server, so retry never doubles a live job', () => {
		const longestOpenSec = JOB_TTL_SEC + leaseSecFor(MAX_LABELS_PER_JOB) + SWEEP_INTERVAL_SEC;
		expect(PRINT_JOB_POLL_TIMEOUT_MS).toBeGreaterThan(longestOpenSec * 1000);
	});
});

const NOW = Date.parse('2026-11-01T10:00:00.000Z');
const iso = (offsetSec: number) => new Date(NOW + offsetSec * 1000).toISOString();

describe('CLOCK_SKEW_SEC', () => {
	it('tolerates 5 seconds of clock skew', () => {
		expect(CLOCK_SKEW_SEC).toBe(5);
	});
});

describe('effectiveExpiryMs', () => {
	it('uses expires_at when it is inside the TTL window', () => {
		const job = { created_at: iso(0), expires_at: iso(60) };
		expect(effectiveExpiryMs(job)).toBe(NOW + 60_000);
	});

	it('caps a forged far-future expires_at at created_at + TTL', () => {
		const job = { created_at: iso(0), expires_at: iso(86_400) };
		expect(effectiveExpiryMs(job)).toBe(NOW + 120_000);
	});

	it.each([
		['created_at', { created_at: 'yesterday', expires_at: iso(60) }],
		['expires_at', { created_at: iso(0), expires_at: 'soon' }],
		['both', { created_at: '', expires_at: '' }]
	])('is already expired (-Infinity) when %s is not a valid timestamp', (_name, job) => {
		expect(effectiveExpiryMs(job)).toBe(-Infinity);
	});
});

describe('isCreatedInFuture', () => {
	it('flags a created_at more than 5 s ahead of now', () => {
		expect(isCreatedInFuture({ created_at: iso(6) }, NOW)).toBe(true);
	});

	it('allows up to 5 s of skew, boundary included', () => {
		expect(isCreatedInFuture({ created_at: iso(4) }, NOW)).toBe(false);
		expect(isCreatedInFuture({ created_at: iso(5) }, NOW)).toBe(false);
	});

	it('accepts a Date as now', () => {
		expect(isCreatedInFuture({ created_at: iso(6) }, new Date(NOW))).toBe(true);
	});
});

describe('isPendingExpired', () => {
	const honest = { created_at: iso(0), expires_at: iso(120) };

	it('keeps an honest job alive inside its TTL', () => {
		expect(isPendingExpired(honest, NOW + 119_999)).toBe(false);
	});

	it('expires exactly at the real expiry', () => {
		expect(isPendingExpired(honest, NOW + 120_000)).toBe(true);
	});

	it('expires a job whose expires_at was forged a day ahead once 120 s passed', () => {
		const forged = { created_at: iso(0), expires_at: iso(86_400) };
		expect(isPendingExpired(forged, NOW + 119_000)).toBe(false);
		expect(isPendingExpired(forged, NOW + 120_000)).toBe(true);
	});

	it('expires a job whose created_at is forged 6 s into the future', () => {
		const forged = { created_at: iso(6), expires_at: iso(126) };
		expect(isPendingExpired(forged, NOW)).toBe(true);
	});

	it('keeps a job whose created_at is only 4 s ahead (clock skew)', () => {
		const skewed = { created_at: iso(4), expires_at: iso(124) };
		expect(isPendingExpired(skewed, NOW)).toBe(false);
	});

	it('expires a job with non-ISO timestamps', () => {
		expect(isPendingExpired({ created_at: 'x', expires_at: 'y' }, NOW)).toBe(true);
	});

	it('accepts a Date as now', () => {
		expect(isPendingExpired(honest, new Date(NOW + 120_000))).toBe(true);
	});
});
