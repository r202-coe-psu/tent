import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Multi-shift apply (#716) against a small in-memory CouchDB: writes land in `docs`, and
 * `_find` reads them back, so the second shift of a request sees the profile and the
 * assignment the first one wrote — as it does against the real database.
 */
const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));

function matches(doc: Record<string, unknown>, selector: Record<string, unknown>): boolean {
	return Object.entries(selector).every(([key, wanted]) => {
		const value = doc[key];
		if (wanted && typeof wanted === 'object' && '$in' in wanted) {
			return (wanted.$in as unknown[]).includes(value);
		}
		return value === wanted;
	});
}

vi.mock('$lib/db/hash', () => ({
	sha256Hex: vi.fn(async (value: string) => `${value}-hash`)
}));

let ulidCounter = 0;
vi.mock('$lib/db/ulid', () => ({
	ulid: vi.fn(() => `01TEST${String(++ulidCounter).padStart(4, '0')}`)
}));

vi.mock('$lib/server/couch-public-writer', () => ({
	getAsPublicWriter: vi.fn(async (_db: string, id: string) => {
		const doc = store.docs.get(id);
		return doc ? { status: 200, data: structuredClone(doc) } : { status: 404, data: null };
	}),
	findAsPublicWriter: vi.fn(async (_db: string, selector: Record<string, unknown>) => ({
		status: 200,
		data: { docs: [...store.docs.values()].filter((doc) => matches(doc, selector)) }
	})),
	putAsPublicWriter: vi.fn(async (_db: string, id: string, doc: Record<string, unknown>) => {
		store.docs.set(id, structuredClone(doc));
		return { status: 201, data: { ok: true, id, rev: '1-x' } };
	}),
	rollbackAsPublicWriter: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));
vi.mock('$lib/server/master-data-server', () => ({
	readEffectiveMasterDoc: vi.fn(async () => null)
}));
vi.mock('$lib/server/shelter-access-design', () => ({ shelterDbName: () => 'shelter_sh001' }));

import { applyPublicVolunteerApplicationToShifts } from './public-application';

function shift(id: string, date: string, start: string, end: string, remaining = 2) {
	return {
		id,
		date,
		end_date: date,
		start_time: start,
		end_time: end,
		quota: 2,
		slots_confirmed: 2 - remaining,
		slots_remaining: remaining
	};
}

function seedJob(shifts: ReturnType<typeof shift>[], override: Record<string, unknown> = {}) {
	store.docs.set('job:target', {
		_id: 'job:target',
		type: 'job',
		schema_v: 3,
		shelter_code: 'SH001',
		title: 'งานคัดแยกของบริจาค',
		status: 'open',
		tier: 'operational',
		auto_accept: true,
		quota: shifts.reduce((sum, s) => sum + s.quota, 0),
		slots_confirmed: shifts.reduce((sum, s) => sum + s.slots_confirmed, 0),
		slots_dispatched: 0,
		slots_remaining: shifts.reduce((sum, s) => sum + s.slots_remaining, 0),
		shifts,
		...override
	});
}

const person = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	email: '',
	skills: [],
	shelter_code: 'SH001'
};

const applications = () => [...store.docs.values()].filter((doc) => doc.type === 'job_application');

// The fixture shifts are in September 2026; pin the clock so they have not ended yet.
afterEach(() => {
	vi.useRealTimers();
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-01T00:00:00+07:00'));
	store.docs.clear();
	ulidCounter = 0;
});

describe('applyPublicVolunteerApplicationToShifts', () => {
	it('saves one application per shift, all confirmed for a new applicant on an auto-accept job', async () => {
		seedJob([
			shift('d1-am', '2026-09-20', '08:00', '12:00'),
			shift('d2-am', '2026-09-21', '08:00', '12:00')
		]);

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'd1-am' },
			{ shift_id: 'd2-am' }
		]);

		expect(result.results).toMatchObject([
			{ ok: true, shift_id: 'd1-am', status: 'confirmed' },
			{ ok: true, shift_id: 'd2-am', status: 'confirmed' }
		]);
		expect(applications().map((doc) => doc.shift_id)).toEqual(['d1-am', 'd2-am']);
		// One profile, and its pass token is handed out once.
		expect([...store.docs.values()].filter((doc) => doc.type === 'volunteer')).toHaveLength(1);
		expect(result.volunteer_token).toEqual(expect.any(String));
	});

	it('saves the open shifts and reports one that has ended as SHIFT_CLOSED (#972)', async () => {
		seedJob([
			shift('d1-am', '2026-09-20', '08:00', '12:00'),
			shift('d2-am', '2026-09-21', '08:00', '12:00')
		]);
		// Mid-way through the second shift: it is still open. The first ended yesterday.
		vi.setSystemTime(new Date('2026-09-21T10:00:00+07:00'));

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'd1-am' },
			{ shift_id: 'd2-am' }
		]);

		expect(result.results).toMatchObject([
			{ ok: false, shift_id: 'd1-am', error: 'SHIFT_CLOSED' },
			{ ok: true, shift_id: 'd2-am', status: 'confirmed' }
		]);
		expect(applications().map((doc) => doc.shift_id)).toEqual(['d2-am']);
	});

	it('saves the shifts that pass and reports the full one', async () => {
		seedJob([
			shift('d1-am', '2026-09-20', '08:00', '12:00'),
			shift('d2-am', '2026-09-21', '08:00', '12:00', 0)
		]);

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'd1-am' },
			{ shift_id: 'd2-am' }
		]);

		expect(result.results).toMatchObject([
			{ ok: true, shift_id: 'd1-am' },
			{ ok: false, shift_id: 'd2-am', error: 'SHIFT_FULL', http_status: 409 }
		]);
		expect(applications().map((doc) => doc.shift_id)).toEqual(['d1-am']);
	});

	it('keeps the earlier of two picked shifts that overlap and reports the later one', async () => {
		seedJob(
			[
				shift('am', '2026-09-20', '08:00', '12:00'),
				shift('late-am', '2026-09-20', '10:00', '14:00')
			],
			// Review jobs write no assignment, so only this request's own check can see the clash.
			{ auto_accept: false }
		);

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'am' },
			{ shift_id: 'late-am' }
		]);

		expect(result.results).toMatchObject([
			{ ok: true, shift_id: 'am', status: 'pending_review' },
			{ ok: false, shift_id: 'late-am', error: 'TIME_CONFLICT' }
		]);
		expect(applications()).toHaveLength(1);
	});

	it('reports a shift the job does not have, and the same shift picked twice', async () => {
		// Two shifts: a one-shift job falls back to its only shift for an unknown id.
		seedJob([
			shift('d1-am', '2026-09-20', '08:00', '12:00'),
			shift('d2-am', '2026-09-21', '08:00', '12:00')
		]);

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'd1-am' },
			{ shift_id: 'gone', shift_date: '2026-09-30' },
			{ shift_id: 'd1-am' }
		]);

		expect(result.results).toMatchObject([
			{ ok: true, shift_id: 'd1-am' },
			{ ok: false, error: 'SHIFT_NOT_FOUND', http_status: 422 },
			{ ok: false, shift_id: 'd1-am', error: 'DUPLICATE_APPLICATION' }
		]);
	});

	it('rejects the whole request when the job is closed, before writing anything', async () => {
		seedJob([shift('d1-am', '2026-09-20', '08:00', '12:00')], { status: 'closed' });

		await expect(
			applyPublicVolunteerApplicationToShifts('job:target', person, [{ shift_id: 'd1-am' }])
		).rejects.toMatchObject({ code: 'JOB_NOT_OPEN' });
		expect(applications()).toEqual([]);
	});

	it('holds every shift for review when the phone already has an unverified profile', async () => {
		seedJob([
			shift('d1-am', '2026-09-20', '08:00', '12:00'),
			shift('d2-am', '2026-09-21', '08:00', '12:00')
		]);
		store.docs.set('volunteer:existing', {
			_id: 'volunteer:existing',
			type: 'volunteer',
			phone_hash: '0812345678-hash',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			skills: [],
			identity_verified: false,
			tracking_token_hash: 'old-hash'
		});

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'd1-am' },
			{ shift_id: 'd2-am' }
		]);

		expect(result.results).toMatchObject([
			{ ok: true, status: 'pending_review' },
			{ ok: true, status: 'pending_review' }
		]);
		expect(result.volunteer_token).toBeUndefined();
	});

	it('applies under the surviving profile when the phone also has a merged one', async () => {
		seedJob([shift('d1-am', '2026-09-20', '08:00', '12:00')]);
		const profile = {
			type: 'volunteer',
			phone_hash: '0812345678-hash',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			skills: [],
			identity_verified: true,
			tracking_token_hash: 'old-hash'
		};
		store.docs.set('volunteer:existing', { _id: 'volunteer:existing', ...profile });
		store.docs.set('volunteer:merged', {
			_id: 'volunteer:merged',
			...profile,
			merged_into: 'volunteer:existing',
			status: 'inactive'
		});

		const result = await applyPublicVolunteerApplicationToShifts('job:target', person, [
			{ shift_id: 'd1-am' }
		]);

		expect(result.results).toMatchObject([{ ok: true }]);
		expect(applications()).toMatchObject([{ volunteer_id: 'volunteer:existing' }]);
	});
});
