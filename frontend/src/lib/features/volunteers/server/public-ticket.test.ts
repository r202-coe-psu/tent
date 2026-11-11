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
import {
	cancelTicket,
	canCancelTicket,
	isTicketCancellable,
	listTicketApplications,
	TicketCancelError
} from './public-ticket';

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

/** Make every PUT of `id` (optionally only when `when(doc)`) fail with `status` until the returned restore runs. */
function failPut(
	id: string,
	status = 500,
	when: (doc: Record<string, unknown>) => boolean = () => true
) {
	const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
	vi.mocked(putAsPublicWriter).mockImplementation(async (d, docId, doc) =>
		docId === id && when(doc as Record<string, unknown>)
			? { status, data: null }
			: realPut(d, docId, doc)
	);
	return () => vi.mocked(putAsPublicWriter).mockImplementation(realPut);
}

const JOB_UNTOUCHED = { slots_confirmed: 1, slots_remaining: 0, status: 'full' };
const JOB_RELEASED = { slots_confirmed: 0, slots_remaining: 1, status: 'open' };
// 2026-10-28 08:00 Bangkok has begun.
const AFTER_START = new Date('2026-10-28T02:00:00Z');

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

	it('pending_review with a live staff-assigned seat releases that seat once (CR-220 FR-11)', async () => {
		// Staff assigned the volunteer directly while the application was still pending: the
		// roster reconcile counted the assignment (`job` fixture: 1 confirmed), so cancelling
		// it from the pass has to give the seat back.
		seed('pending_review');
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1')).toMatchObject({
			status: 'cancelled',
			quota_released_at: NOW.toISOString()
		});
		expect(get('job_application:a1').quota_release_due_at).toBeUndefined();
		expect(get('shift_assignment:x1')).toMatchObject({
			status: 'cancelled',
			cancel_application_id: 'job_application:a1'
		});
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
		await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
			code: 'NOT_CANCELLABLE'
		});
		expect(get('job:j1')).toMatchObject(JOB_RELEASED);
	});

	it('pending_review with a staff-assigned seat: a failed release is retried and releases once', async () => {
		seed('pending_review');
		const restore = failPut('job:j1');
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED',
				httpStatus: 502
			});
		} finally {
			restore();
		}
		expect(get('job_application:a1').status).toBe('pending_review');
		expect(get('shift_assignment:x1').status).toBe('cancelled');
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
		expect(get('job_application:a1').status).toBe('cancelled');
	});

	it('pending_review whose assignment is an unanswered dispatch offer releases no confirmed seat', async () => {
		// An offer sits in slots_dispatched, never in slots_confirmed: nothing to give back here.
		seed('pending_review');
		db.docs.set('shift_assignment:x1', {
			...get('shift_assignment:x1'),
			dispatch_status: 'dispatched'
		});
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('shift_assignment:x1').status).toBe('cancelled');
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job_application:a1').quota_released_at).toBeUndefined();
		expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);
		expect(get('job:j1').released_application_ids).toBeUndefined();
	});

	it('a failed quota release is a retryable 502: the retry gives the quota back exactly once (CR-220 AC-2)', async () => {
		const restore = failPut('job:j1');
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED',
				httpStatus: 502
			});
		} finally {
			restore();
		}
		// The assignment carries the stamp, the application is still cancellable.
		expect(get('job_application:a1').status).toBe('confirmed');
		expect(get('shift_assignment:x1')).toMatchObject({
			status: 'cancelled',
			cancel_application_id: 'job_application:a1',
			schema_v: 6
		});
		expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);

		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1')).toMatchObject({
			status: 'cancelled',
			quota_released_at: NOW.toISOString(),
			schema_v: 4
		});
		expect(get('job_application:a1').quota_release_due_at).toBeUndefined();
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1'],
			schema_v: 4
		});

		await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
			code: 'NOT_CANCELLABLE',
			httpStatus: 409
		});
		expect(get('job:j1')).toMatchObject(JOB_RELEASED);
	});

	it('the release succeeded but writing the application failed: the retry does not release again (AC-3, linked)', async () => {
		const restore = failPut('job_application:a1');
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED',
				httpStatus: 502
			});
		} finally {
			restore();
		}
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
		expect(get('job_application:a1').status).toBe('confirmed');

		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1')).toMatchObject({
			status: 'cancelled',
			quota_released_at: NOW.toISOString()
		});
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
	});

	it('a failed release then a shift that started before the retry is 409 SHIFT_STARTED and writes nothing (AC-10)', async () => {
		const restore = failPut('job:j1');
		try {
			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'WRITE_FAILED'
			});
		} finally {
			restore();
		}
		vi.mocked(putAsPublicWriter).mockClear();
		await expect(cancelTicket('APPTOKEN', 'job_application:a1', AFTER_START)).rejects.toMatchObject(
			{
				code: 'SHIFT_STARTED',
				httpStatus: 409
			}
		);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
		expect(get('job_application:a1').status).toBe('confirmed');
		expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);
	});

	it('an assignment withdrawn earlier (no stamp) is not owed: the application cancels, the quota is not released again (AC-5)', async () => {
		db.docs.set('shift_assignment:x1', { ...get('shift_assignment:x1'), status: 'cancelled' });
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job_application:a1').quota_released_at).toBeUndefined();
		expect(get('job_application:a1').quota_release_due_at).toBeUndefined();
		expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);
		expect(get('job:j1').released_application_ids).toBeUndefined();
	});

	it('an assignment cancelled for another application is not owed either', async () => {
		db.docs.set('shift_assignment:x1', {
			...get('shift_assignment:x1'),
			status: 'cancelled',
			cancel_application_id: 'job_application:other'
		});
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);
	});

	it('a rival cancel of the same application already stamped the assignment and released: nothing is released twice (AC-6, linked)', async () => {
		db.docs.set('shift_assignment:x1', {
			...get('shift_assignment:x1'),
			status: 'cancelled',
			cancel_application_id: 'job_application:a1'
		});
		db.docs.set('job:j1', {
			...get('job:j1'),
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job_application:a1')).toMatchObject({
			status: 'cancelled',
			quota_released_at: NOW.toISOString()
		});
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
	});

	it('losing the assignment race to a rival cancel of the same application still sees its stamp (AC-6, linked)', async () => {
		const realGet = vi.mocked(getAsPublicWriter).getMockImplementation()!;
		vi.mocked(getAsPublicWriter).mockImplementation(async (d, id) =>
			id === 'shift_assignment:x1'
				? {
						status: 200,
						data: {
							...get('shift_assignment:x1'),
							status: 'cancelled',
							cancel_application_id: 'job_application:a1'
						}
					}
				: realGet(d, id)
		);
		try {
			await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		} finally {
			vi.mocked(getAsPublicWriter).mockImplementation(realGet);
		}
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
		expect(get('job_application:a1').status).toBe('cancelled');
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

		it('cancels first with a due marker, then a failed release is resumed by the next press (AC-1)', async () => {
			const restore = failPut('job:j1');
			vi.mocked(putAsPublicWriter).mockClear();
			try {
				await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
					code: 'WRITE_FAILED',
					httpStatus: 502
				});
				const order = vi.mocked(putAsPublicWriter).mock.calls.map((c) => c[1]);
				expect(order.indexOf('job_application:a1')).toBeLessThan(order.indexOf('job:j1'));
			} finally {
				restore();
			}
			expect(get('job_application:a1')).toMatchObject({
				status: 'cancelled',
				quota_release_due_at: NOW.toISOString(),
				schema_v: 4
			});
			expect(get('job_application:a1').quota_released_at).toBeUndefined();
			expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);

			await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
			expect(get('job_application:a1')).toMatchObject({
				status: 'cancelled',
				quota_released_at: NOW.toISOString()
			});
			expect(get('job:j1')).toMatchObject({
				...JOB_RELEASED,
				released_application_ids: ['job_application:a1']
			});

			await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
				code: 'NOT_CANCELLABLE',
				httpStatus: 409
			});
			expect(get('job:j1')).toMatchObject(JOB_RELEASED);
		});

		it('the release succeeded but closing the marker failed: the retry does not release again (AC-3, no assignment)', async () => {
			const restore = failPut('job_application:a1', 500, (doc) => Boolean(doc.quota_released_at));
			try {
				await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
					code: 'WRITE_FAILED',
					httpStatus: 502
				});
			} finally {
				restore();
			}
			expect(get('job:j1')).toMatchObject({
				...JOB_RELEASED,
				released_application_ids: ['job_application:a1']
			});
			expect(get('job_application:a1').quota_released_at).toBeUndefined();

			await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
			expect(get('job_application:a1').quota_released_at).toBe(NOW.toISOString());
			expect(get('job:j1')).toMatchObject({
				...JOB_RELEASED,
				released_application_ids: ['job_application:a1']
			});
		});

		it('resuming a due release skips the shift-start check (FR-6)', async () => {
			const restore = failPut('job:j1');
			try {
				await expect(cancelTicket('APPTOKEN', 'job_application:a1', NOW)).rejects.toMatchObject({
					code: 'WRITE_FAILED'
				});
			} finally {
				restore();
			}
			await cancelTicket('APPTOKEN', 'job_application:a1', AFTER_START);
			expect(get('job_application:a1').quota_released_at).toBe(AFTER_START.toISOString());
			expect(get('job:j1')).toMatchObject(JOB_RELEASED);
		});

		it('a rival cancel that wins the application write leaves it due: this request resumes and the ledger releases once (AC-6)', async () => {
			const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
			let raced = false;
			vi.mocked(putAsPublicWriter).mockImplementation(async (d, id, doc) => {
				if (id === 'job_application:a1' && !raced) {
					raced = true;
					// The rival cancels first and also releases the quota through the ledger.
					db.docs.set(id, {
						...get(id),
						status: 'cancelled',
						quota_release_due_at: NOW.toISOString()
					});
					await realPut(d, 'job:j1', {
						...get('job:j1'),
						...JOB_RELEASED,
						released_application_ids: ['job_application:a1']
					});
					return { status: 409, data: null };
				}
				return realPut(d, id, doc);
			});
			try {
				await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
			} finally {
				vi.mocked(putAsPublicWriter).mockImplementation(realPut);
			}
			expect(get('job_application:a1').quota_released_at).toBe(NOW.toISOString());
			expect(get('job:j1')).toMatchObject({
				...JOB_RELEASED,
				released_application_ids: ['job_application:a1']
			});
		});

		it('a pending_review application with no assignment cancels without any quota marker (AC-8)', async () => {
			seed('pending_review');
			db.docs.delete('shift_assignment:x1');
			await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
			expect(get('job_application:a1').status).toBe('cancelled');
			expect(get('job_application:a1').quota_release_due_at).toBeUndefined();
			expect(get('job_application:a1').quota_released_at).toBeUndefined();
			expect(get('job:j1')).toMatchObject(JOB_UNTOUCHED);
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

describe('canCancelTicket', () => {
	const app = (over: Record<string, unknown>) =>
		({
			_id: 'a',
			type: 'job_application',
			status: 'confirmed',
			selected_shift: { date: FUTURE, start_time: '08:00', end_time: '12:00' },
			...over
		}) as Parameters<typeof canCancelTicket>[0];
	const due = NOW.toISOString();

	it('offers a normal cancel exactly like isTicketCancellable', () => {
		expect(canCancelTicket(app({}), NOW)).toBe(true);
		expect(canCancelTicket(app({ selected_shift: undefined }), NOW)).toBe(false);
		expect(canCancelTicket(null, NOW)).toBe(false);
	});

	it('also offers finishing a release that is still due, even after the shift started (AC-9)', () => {
		const resumable = app({ status: 'cancelled', quota_release_due_at: due });
		expect(isTicketCancellable(resumable, NOW)).toBe(false);
		expect(canCancelTicket(resumable, NOW)).toBe(true);
		expect(canCancelTicket(resumable, AFTER_START)).toBe(true);
	});

	it('is false once released, or for any other cancelled application (AC-9)', () => {
		expect(
			canCancelTicket(
				app({ status: 'cancelled', quota_release_due_at: due, quota_released_at: due }),
				NOW
			)
		).toBe(false);
		expect(canCancelTicket(app({ status: 'cancelled' }), NOW)).toBe(false);
		expect(canCancelTicket(app({ status: 'rejected', quota_release_due_at: due }), NOW)).toBe(
			false
		);
	});
});

/**
 * A fake that behaves like CouchDB for the documents these tests touch: every PUT must carry
 * the current `_rev` or it is a 409, so two interleaved cancels really do conflict instead of
 * silently overwriting each other (the default mock accepts any write).
 */
function enforceRevisions() {
	const revs = new Map<string, number>();
	const revOf = (id: string) => `${revs.get(id) ?? 1}-fake`;
	const stats = { conflicts: 0 };
	const realGet = vi.mocked(getAsPublicWriter).getMockImplementation()!;
	const realPut = vi.mocked(putAsPublicWriter).getMockImplementation()!;
	vi.mocked(getAsPublicWriter).mockImplementation(async (d, id) => {
		const res = await realGet(d, id);
		return res.status === 200
			? { ...res, data: { ...(res.data as Record<string, unknown>), _rev: revOf(id) } }
			: res;
	});
	vi.mocked(putAsPublicWriter).mockImplementation(async (d, id, doc) => {
		if ((doc as Record<string, unknown>)._rev !== revOf(id)) {
			stats.conflicts++;
			return { status: 409, data: null };
		}
		const { _rev: _ignored, ...stored } = doc as Record<string, unknown>;
		void _ignored;
		revs.set(id, (revs.get(id) ?? 1) + 1);
		return realPut(d, id, stored);
	});
	return {
		stats,
		restore: () => {
			vi.mocked(getAsPublicWriter).mockImplementation(realGet);
			vi.mocked(putAsPublicWriter).mockImplementation(realPut);
		}
	};
}

describe('cancelTicket with _rev-enforcing storage', () => {
	it.each([
		['linked assignment', true],
		['no assignment', false]
	])('two simultaneous cancels (%s) release the quota exactly once', async (_label, linked) => {
		seed('confirmed');
		if (!linked) db.docs.delete('shift_assignment:x1');
		const fake = enforceRevisions();
		try {
			const results = await Promise.allSettled([
				cancelTicket('APPTOKEN', 'job_application:a1', NOW),
				cancelTicket('APPTOKEN', 'job_application:a1', NOW)
			]);
			// A rival may lose with 409 NOT_CANCELLABLE; nothing else is an acceptable failure.
			for (const r of results) {
				if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'NOT_CANCELLABLE' });
			}
			expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
			// The fake must actually have refused a stale write, or this proves nothing.
			expect(fake.stats.conflicts).toBeGreaterThan(0);
		} finally {
			fake.restore();
		}
		expect(get('job_application:a1').status).toBe('cancelled');
		expect(get('job_application:a1').quota_released_at).toBeDefined();
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});
		expect(get('job:j1').shifts).toEqual([
			{ shift_id: 'shift:s1', slots_confirmed: 0, slots_remaining: 1 }
		]);
	});
});

describe('re-booking after a cancel (CR-220 ledger is per application)', () => {
	it('a new application for the same job releases its own quota; the old key does not block it', async () => {
		seed('confirmed');
		await cancelTicket('APPTOKEN', 'job_application:a1', NOW);
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1']
		});

		// Same volunteer books the same shift again: a new application and assignment, and the
		// seat is taken again.
		db.docs.set('job_application:a2', {
			...get('job_application:a1'),
			_id: 'job_application:a2',
			tracking_token_hash: 'APP2TOKEN-hash',
			status: 'confirmed',
			quota_released_at: undefined
		});
		db.docs.set('shift_assignment:x2', {
			...get('shift_assignment:x1'),
			_id: 'shift_assignment:x2',
			status: 'assigned',
			cancel_application_id: undefined
		});
		db.docs.set('job:j1', {
			...get('job:j1'),
			...JOB_UNTOUCHED,
			shifts: [{ shift_id: 'shift:s1', slots_confirmed: 1, slots_remaining: 0 }]
		});

		await cancelTicket('APP2TOKEN', 'job_application:a2', NOW);
		expect(get('job_application:a2')).toMatchObject({
			status: 'cancelled',
			quota_released_at: NOW.toISOString()
		});
		// a1's stamped assignment (x1) is not a2's: only x2 is cancelled for a2.
		expect(get('shift_assignment:x2')).toMatchObject({
			status: 'cancelled',
			cancel_application_id: 'job_application:a2'
		});
		expect(get('job:j1')).toMatchObject({
			...JOB_RELEASED,
			released_application_ids: ['job_application:a1', 'job_application:a2']
		});
		expect(get('job:j1').shifts).toEqual([
			{ shift_id: 'shift:s1', slots_confirmed: 0, slots_remaining: 1 }
		]);
	});
});

describe('listTicketApplications (#973)', () => {
	beforeEach(() => seed('confirmed'));

	function addOther() {
		db.docs.set('volunteer:v2', {
			_id: 'volunteer:v2',
			type: 'volunteer',
			first_name: 'ข',
			tracking_token_hash: 'OTHERTOKEN-hash'
		});
		db.docs.set('job_application:b1', {
			_id: 'job_application:b1',
			type: 'job_application',
			job_id: 'job:j9',
			volunteer_id: 'volunteer:v2',
			tracking_token_hash: 'OTHERAPP-hash',
			status: 'confirmed',
			selected_shift: { date: FUTURE, start_time: '08:00', end_time: '12:00' }
		});
	}

	it('lists only the applications of the permanent token owner, with the cancel verdict', async () => {
		addOther();
		const list = await listTicketApplications('VOLTOKEN', NOW);
		expect(list).toEqual([
			{
				application_id: 'job_application:a1',
				status: 'confirmed',
				job_id: 'job:j1',
				shift_id: 'shift:s1',
				date: FUTURE,
				can_cancel: true
			}
		]);
	});

	it('says cancel is not offered once the shift started', async () => {
		const list = await listTicketApplications('VOLTOKEN', AFTER_START);
		expect(list?.[0].can_cancel).toBe(false);
	});

	it('an application token lists just its own application', async () => {
		addOther();
		const list = await listTicketApplications('APPTOKEN', NOW);
		expect(list?.map((a) => a.application_id)).toEqual(['job_application:a1']);
	});

	it('is null for an unknown token', async () => {
		expect(await listTicketApplications('NOPE', NOW)).toBeNull();
	});

	it("cannot cancel another volunteer's application with my permanent token", async () => {
		addOther();
		await expect(cancelTicket('VOLTOKEN', 'job_application:b1', NOW)).rejects.toMatchObject({
			httpStatus: 409
		});
		expect(get('job_application:b1').status).toBe('confirmed');
	});
});
