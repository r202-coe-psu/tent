import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));

vi.mock('$lib/db/hash', () => ({ sha256Hex: vi.fn(async (v: string) => `${v}-hash`) }));
vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(
		async (path: string, _m: string, body?: { selector: Record<string, unknown> }) => {
			if (path.startsWith('/registry')) return { status: 404, data: {} };
			return { status: 200, data: { docs: match(body?.selector ?? {}) } };
		}
	)
}));
vi.mock('$lib/server/couch-public-writer', () => ({
	getAsPublicWriter: vi.fn(async (_db: string, id: string) => {
		const doc = db.docs.get(id);
		return doc ? { status: 200, data: structuredClone(doc) } : { status: 404, data: null };
	}),
	findAsPublicWriter: vi.fn(async (_db: string, selector: Record<string, unknown>) => ({
		status: 200,
		data: { docs: match(selector) }
	})),
	putAsPublicWriter: vi.fn(async (_db: string, id: string, doc: Record<string, unknown>) => {
		db.docs.set(id, structuredClone(doc));
		return { status: 201, data: { ok: true } };
	})
}));

function match(selector: Record<string, unknown>) {
	const or = selector.$or as Record<string, unknown>[] | undefined;
	return [...db.docs.values()].filter((doc) => {
		const plain = Object.entries(selector).filter(([k]) => k !== '$or');
		if (!plain.every(([k, v]) => doc[k] === v)) return false;
		return !or || or.some((c) => Object.entries(c).every(([k, v]) => doc[k] === v));
	});
}

import { cancelTicket, isTicketCancellable, TicketCancelError } from './public-ticket';

const NOW = new Date('2026-10-27T03:00:00Z'); // 10:00 Bangkok
const FUTURE = '2026-10-28';

function seed(status: string, date = FUTURE) {
	db.docs.clear();
	db.docs.set('volunteer:v1', {
		_id: 'volunteer:v1',
		type: 'volunteer',
		first_name: 'ก',
		tracking_token_hash: 'VOLTOKEN-hash'
	});
	db.docs.set('job_application:a1', {
		_id: 'job_application:a1',
		type: 'job_application',
		job_id: 'job:j1',
		shift_id: 'shift:s1',
		volunteer_id: 'volunteer:v1',
		tracking_token_hash: 'APPTOKEN-hash',
		status,
		selected_shift: { shift_id: 'shift:s1', date, start_time: '08:00', end_time: '12:00' }
	});
	db.docs.set('shift_assignment:x1', {
		_id: 'shift_assignment:x1',
		type: 'shift_assignment',
		job_id: 'job:j1',
		shift_id: 'shift:s1',
		volunteer_id: 'volunteer:v1',
		date,
		status: 'assigned'
	});
	db.docs.set('job:j1', {
		_id: 'job:j1',
		type: 'job',
		status: 'full',
		slots_confirmed: 1,
		slots_remaining: 0,
		shifts: [{ shift_id: 'shift:s1', slots_confirmed: 1, slots_remaining: 0 }]
	});
}

const get = (id: string) => db.docs.get(id) as Record<string, unknown>;

describe('cancelTicket', () => {
	beforeEach(() => seed('confirmed'));

	it('cancels via the application token and releases quota', async () => {
		await cancelTicket('APPTOKEN', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('shift_assignment:x1').status).toBe('cancelled');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 0, slots_remaining: 1, status: 'open' });
	});

	it("cancels via the volunteer's permanent token (same application as the pass)", async () => {
		await cancelTicket('VOLTOKEN', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('shift_assignment:x1').status).toBe('cancelled');
	});

	it('second cancel is 409 and releases quota only once', async () => {
		await cancelTicket('APPTOKEN', NOW);
		await expect(cancelTicket('APPTOKEN', NOW)).rejects.toMatchObject({
			code: 'NOT_CANCELLABLE',
			httpStatus: 409
		});
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 0, slots_remaining: 1 });
	});

	it('refuses once the shift has started', async () => {
		seed('confirmed', '2026-10-12');
		await expect(cancelTicket('VOLTOKEN', NOW)).rejects.toMatchObject({
			code: 'SHIFT_STARTED',
			httpStatus: 409
		});
		expect(get('job_application:a1').status).toBe('confirmed');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1 });
	});

	it('pending_review cancels without touching quota', async () => {
		seed('pending_review');
		await cancelTicket('APPTOKEN', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0, status: 'full' });
	});

	it('404 for an unknown token', async () => {
		await expect(cancelTicket('NOPE', NOW)).rejects.toBeInstanceOf(TicketCancelError);
	});
});

describe('isTicketCancellable', () => {
	const app = (status: string, date: string) =>
		({
			_id: 'a',
			type: 'job_application',
			status,
			selected_shift: { date, start_time: '08:00', end_time: '12:00' }
		}) as Parameters<typeof isTicketCancellable>[0];

	it('is true only for a live status on a future shift', () => {
		expect(isTicketCancellable(app('confirmed', FUTURE), NOW)).toBe(true);
		expect(isTicketCancellable(app('pending_review', FUTURE), NOW)).toBe(true);
		expect(isTicketCancellable(app('cancelled', FUTURE), NOW)).toBe(false);
		expect(isTicketCancellable(app('confirmed', '2026-10-12'), NOW)).toBe(false);
		expect(isTicketCancellable(null, NOW)).toBe(false);
	});

	it('uses the Bangkok start time on the shift day', () => {
		const today = app('confirmed', '2026-10-27');
		expect(isTicketCancellable(today, new Date('2026-10-27T00:59:00Z'))).toBe(true); // 07:59
		expect(isTicketCancellable(today, new Date('2026-10-27T01:00:00Z'))).toBe(false); // 08:00
	});
});
