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

import {
	findAsPublicWriter,
	getAsPublicWriter,
	putAsPublicWriter
} from '$lib/server/couch-public-writer';
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
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('shift_assignment:x1').status).toBe('cancelled');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 0, slots_remaining: 1, status: 'open' });
	});

	it("cancels via the volunteer's permanent token (same application as the pass)", async () => {
		await cancelTicket('VOLTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('shift_assignment:x1').status).toBe('cancelled');
	});

	it('second cancel is 409 and releases quota only once', async () => {
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
			code: 'NOT_CANCELLABLE',
			httpStatus: 409
		});
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 0, slots_remaining: 1 });
	});

	it('refuses once the shift has started', async () => {
		seed('confirmed', '2026-10-12');
		await expect(cancelTicket('VOLTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
			code: 'SHIFT_STARTED',
			httpStatus: 409
		});
		expect(get('job_application:a1').status).toBe('confirmed');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1 });
	});

	it('pending_review cancels without touching quota', async () => {
		seed('pending_review');
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0, status: 'full' });
	});

	it('a failed quota release is a retryable 502 and never double-releases', async () => {
		const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
		vi.mocked(putAsPublicWriter).mockImplementation(async (d, id, doc) =>
			id === 'job:j1' ? { status: 500, data: null } : realPut(d, id, doc)
		);
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED',
				httpStatus: 502
			});
		} finally {
			vi.mocked(putAsPublicWriter).mockImplementation(realPut);
		}
		expect(get('job_application:a1').status).toBe('confirmed');
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		// The assignment was already cancelled by the failed attempt: no second release.
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 });
	});

	it('a failed assignment lookup is 502 and writes nothing', async () => {
		vi.mocked(findAsPublicWriter).mockResolvedValueOnce({ status: 500, data: null } as never);
		vi.mocked(putAsPublicWriter).mockClear();
		await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
			code: 'WRITE_FAILED',
			httpStatus: 502
		});
		expect(putAsPublicWriter).not.toHaveBeenCalled();
		expect(get('job_application:a1').status).toBe('confirmed');
	});

	it('a failed fresh assignment read (500) is 502 and leaves the application, shift and quota alone', async () => {
		const realGet = vi.mocked(getAsPublicWriter).getMockImplementation()!;
		vi.mocked(getAsPublicWriter).mockImplementation(async (d, id) =>
			id === 'shift_assignment:x1' ? ({ status: 500, data: null } as never) : realGet(d, id)
		);
		vi.mocked(putAsPublicWriter).mockClear();
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED',
				httpStatus: 502
			});
		} finally {
			vi.mocked(getAsPublicWriter).mockImplementation(realGet);
		}
		expect(putAsPublicWriter).not.toHaveBeenCalled();
		expect(get('job_application:a1').status).toBe('confirmed');
		expect(get('shift_assignment:x1').status).toBe('assigned');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 });
	});

	it('an assignment deleted meanwhile (404) is settled: the application cancels, no quota back', async () => {
		const realGet = vi.mocked(getAsPublicWriter).getMockImplementation()!;
		vi.mocked(getAsPublicWriter).mockImplementation(async (d, id) =>
			id === 'shift_assignment:x1' ? ({ status: 404, data: null } as never) : realGet(d, id)
		);
		try {
			await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		} finally {
			vi.mocked(getAsPublicWriter).mockImplementation(realGet);
		}
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 });
	});

	it('an assignment PUT that keeps conflicting is 409, the application is never written', async () => {
		const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
		vi.mocked(putAsPublicWriter).mockImplementation(async (d, id, doc) =>
			id === 'shift_assignment:x1' ? { status: 409, data: null } : realPut(d, id, doc)
		);
		vi.mocked(putAsPublicWriter).mockClear();
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED',
				httpStatus: 409
			});
		} finally {
			vi.mocked(putAsPublicWriter).mockImplementation(realPut);
		}
		expect(putAsPublicWriter).toHaveBeenCalledTimes(5);
		expect(putAsPublicWriter).not.toHaveBeenCalledWith(
			expect.anything(),
			'job_application:a1',
			expect.anything()
		);
		expect(get('job_application:a1').status).toBe('confirmed');
		expect(get('shift_assignment:x1').status).toBe('assigned');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 });
	});

	it('an assignment already cancelled concurrently is skipped, not retried or double-released', async () => {
		const realGet = vi.mocked(getAsPublicWriter).getMockImplementation()!;
		vi.mocked(getAsPublicWriter).mockImplementation(async (d, id) =>
			id === 'shift_assignment:x1'
				? { status: 200, data: { ...get('shift_assignment:x1'), status: 'cancelled' } }
				: realGet(d, id)
		);
		try {
			await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		} finally {
			vi.mocked(getAsPublicWriter).mockImplementation(realGet);
		}
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 });
	});

	it('the volunteer token follows the earliest cancellable application', async () => {
		const addApp = (id: string, status: string, date: string) =>
			db.docs.set(`job_application:${id}`, {
				_id: `job_application:${id}`,
				type: 'job_application',
				job_id: 'job:j1',
				shift_id: 'shift:s1',
				volunteer_id: 'volunteer:v1',
				status,
				selected_shift: { shift_id: 'shift:s1', date, start_time: '08:00', end_time: '12:00' }
			});
		db.docs.delete('job_application:a1');
		db.docs.delete('shift_assignment:x1');
		addApp('old-cancelled', 'cancelled', '2026-10-10');
		addApp('old-confirmed', 'confirmed', '2026-10-12');
		addApp('later', 'confirmed', '2026-10-30');
		addApp('soon', 'confirmed', '2026-10-28');

		await cancelTicket('VOLTOKEN', 'job_application:soon', NOW);
		expect(get('job_application:soon').status).toBe('cancelled');
		expect(get('job_application:later').status).toBe('confirmed');
		expect(get('job_application:old-confirmed').status).toBe('confirmed');

		await cancelTicket('VOLTOKEN', 'job_application:later', NOW);
		expect(get('job_application:later').status).toBe('cancelled');
	});

	it('refuses a stale application id on a permanent token (pass showed A, B is now first)', async () => {
		db.docs.set('job_application:b1', {
			...get('job_application:a1'),
			_id: 'job_application:b1',
			tracking_token_hash: undefined,
			selected_shift: {
				shift_id: 'shift:s1',
				date: '2026-10-27',
				start_time: '15:00',
				end_time: '17:00'
			}
		});
		// The server would now show b1 (starts sooner); a pass rendered earlier still shows a1.
		await cancelTicket('VOLTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job_application:b1').status).toBe('confirmed');
		// a1 is no longer cancellable: a repeat with the stale id must not fall through to b1.
		await expect(cancelTicket('VOLTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
			code: 'NOT_CANCELLABLE',
			httpStatus: 409
		});
		expect(get('job_application:b1').status).toBe('confirmed');
	});

	it('refuses an application id that does not belong to the token (or is missing)', async () => {
		db.docs.set('job_application:other', {
			...get('job_application:a1'),
			_id: 'job_application:other',
			volunteer_id: 'volunteer:v2',
			tracking_token_hash: 'OTHER-hash'
		});
		for (const [token, id] of [
			['APPTOKEN', 'job_application:other'],
			['VOLTOKEN', 'job_application:other'],
			['VOLTOKEN', '']
		]) {
			await expect(cancelTicket(token, id, NOW)).rejects.toMatchObject({
				code: 'NOT_CANCELLABLE',
				httpStatus: 409
			});
		}
		expect(get('job_application:other').status).toBe('confirmed');
		expect(get('job_application:a1').status).toBe('confirmed');
	});

	describe('confirmed application with no linked assignment', () => {
		beforeEach(() => db.docs.delete('shift_assignment:x1'));

		it('marks the application cancelled before releasing quota; a failed release never over-releases', async () => {
			const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
			vi.mocked(putAsPublicWriter).mockImplementation(async (d, id, doc) =>
				id === 'job:j1' ? { status: 500, data: null } : realPut(d, id, doc)
			);
			vi.mocked(putAsPublicWriter).mockClear();
			try {
				await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
					code: 'WRITE_FAILED',
					httpStatus: 502
				});
				const order = vi.mocked(putAsPublicWriter).mock.calls.map((c) => c[1]);
				expect(order.indexOf('job_application:a1')).toBeLessThan(order.indexOf('job:j1'));
				// Retry after the failed release: already cancelled, so no second release.
				await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
					code: 'NOT_CANCELLABLE'
				});
			} finally {
				vi.mocked(putAsPublicWriter).mockImplementation(realPut);
			}
			expect(get('job_application:a1').status).toBe('cancelled');
			expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 }); // short, not over
		});

		it('a concurrent cancel that wins the application write gets 409 and releases nothing', async () => {
			const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
			vi.mocked(putAsPublicWriter).mockImplementation(async (d, id, doc) => {
				if (id === 'job_application:a1') {
					// Rival cancel lands first: our rev-bound PUT conflicts.
					db.docs.set(id, { ...get(id), status: 'cancelled' });
					return { status: 409, data: null };
				}
				return realPut(d, id, doc);
			});
			try {
				await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
					code: 'NOT_CANCELLABLE',
					httpStatus: 409
				});
			} finally {
				vi.mocked(putAsPublicWriter).mockImplementation(realPut);
			}
			expect(get('job:j1')).toMatchObject({ slots_confirmed: 1, slots_remaining: 0 });
		});
	});

	it.each(['checked_in', 'completed'])(
		'refuses with SHIFT_STARTED and writes nothing when an assignment is %s',
		async (status) => {
			db.docs.set('shift_assignment:x1', { ...get('shift_assignment:x1'), status });
			vi.mocked(putAsPublicWriter).mockClear();
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'SHIFT_STARTED',
				httpStatus: 409
			});
			expect(putAsPublicWriter).not.toHaveBeenCalled();
			expect(get('job_application:a1').status).toBe('confirmed');
			expect(get('shift_assignment:x1').status).toBe(status);
			expect(get('job:j1')).toMatchObject({ slots_confirmed: 1 });
		}
	);

	it('aborts without writing the application when its status changed during the request', async () => {
		const realGet = vi.mocked(getAsPublicWriter).getMockImplementation()!;
		let appReads = 0;
		vi.mocked(getAsPublicWriter).mockImplementation(async (d, id) => {
			const res = await realGet(d, id);
			if (id === 'job_application:a1' && ++appReads > 1) {
				// Staff moved it on after the first read.
				(res.data as Record<string, unknown>).status = 'pending_review';
			}
			return res;
		});
		vi.mocked(putAsPublicWriter).mockClear();
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'NOT_CANCELLABLE',
				httpStatus: 409
			});
		} finally {
			vi.mocked(getAsPublicWriter).mockImplementation(realGet);
		}
		expect(putAsPublicWriter).not.toHaveBeenCalledWith(
			expect.anything(),
			'job_application:a1',
			expect.anything()
		);
		expect(get('job_application:a1').status).toBe('confirmed');
	});

	it('404 for an unknown token', async () => {
		await expect(cancelTicket('NOPE', 'job_application:a1', NOW)).rejects.toBeInstanceOf(
			TicketCancelError
		);
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
