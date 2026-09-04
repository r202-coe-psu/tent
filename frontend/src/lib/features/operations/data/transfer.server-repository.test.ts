import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	TransferServerRepository,
	TransferServerRepositoryError
} from './transfer.server-repository';
import type { StockTransfer } from '../domain/operations';

const adminRaw = vi.fn();

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: (...args: unknown[]) => adminRaw(...args)
}));

const TRANSFER_ID = 'stock_transfer:01TRANSFER0000000000000000';

/** CR-089 FR-01 — every dispatch must name a driver and plate. */
const DISPATCH_OPTS = { driver_name: 'สมชาย ใจดี', vehicle_plate: 'กข 1234 เชียงราย' };

function requestedTransfer(overrides: Partial<StockTransfer> = {}): StockTransfer {
	return {
		_id: TRANSFER_ID,
		_rev: '1-abc',
		type: 'stock_transfer',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-22T05:00:00.000Z',
		updated_at: '2026-08-22T05:00:00.000Z',
		created_by: 'Staff A',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' } },
		...overrides
	} as StockTransfer;
}

function isFindWithField(
	body: unknown,
	field: string
): body is { selector: Record<string, unknown> } {
	return (
		!!body &&
		typeof body === 'object' &&
		'selector' in body &&
		!!(body as { selector?: Record<string, unknown> }).selector &&
		field in (body as { selector: Record<string, unknown> }).selector
	);
}

describe('TransferServerRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a transfer doc in central_ops', async () => {
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'PUT' && decoded.startsWith('/central_ops/stock_transfer:')) {
				return { status: 201, data: { ok: true, id: 'x', rev: '1-new' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		const doc = await repo.create(
			{
				from_shelter: 'SH001',
				to_shelter: 'SH002',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			},
			{ shelterCode: 'SH001', createdBy: 'Staff A' }
		);

		expect(doc.status).toBe('requested');
		expect(doc._rev).toBe('1-new');
	});

	it('lists transfers scoped to the context shelter via $or', async () => {
		let capturedBody: unknown;
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			if (method === 'POST' && String(path).endsWith('/_find')) {
				capturedBody = body;
				return { status: 200, data: { docs: [] } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH002');
		await repo.list();

		expect(capturedBody).toMatchObject({
			selector: {
				type: 'stock_transfer',
				$or: [{ from_shelter: 'SH002' }, { to_shelter: 'SH002' }]
			}
		});
	});

	it('returns null for a missing transfer', async () => {
		adminRaw.mockImplementation(async (_path: string, method: string) => {
			if (method === 'GET') return { status: 404, data: { error: 'not_found' } };
			return { status: 200, data: {} };
		});
		const repo = new TransferServerRepository('central_ops', 'SH001');
		expect(await repo.get(TRANSFER_ID)).toBeNull();
	});

	it('rejects a transition for a transfer that does not exist (404)', async () => {
		adminRaw.mockImplementation(async (_path: string, method: string) => {
			if (method === 'GET') return { status: 404, data: { error: 'not_found' } };
			return { status: 200, data: {} };
		});
		const repo = new TransferServerRepository('central_ops', 'SH001');
		await expect(
			repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001', DISPATCH_OPTS)
		).rejects.toMatchObject({ status: 404 });
	});

	it('rejects dispatch from a shelter that is not the source (403)', async () => {
		const doc = requestedTransfer();
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH999');
		await expect(
			repo.transition(TRANSFER_ID, 'shipped', 'Staff B', 'SH999', DISPATCH_OPTS)
		).rejects.toMatchObject({ status: 403 });
	});

	it('rejects dispatch when source stock is insufficient (422)', async () => {
		const doc = requestedTransfer();
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			// `ref_id` is checked first — it's unique to the ledgerAlreadyWritten idempotency
			// query, whereas `item_id` is present on both that query and the balance-check query
			// below (see the "dispatches" test further down for the same distinction).
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'ref_id')
			) {
				return { status: 200, data: { docs: [] } }; // not written yet — sufficiency still applies
			}
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'item_id')
			) {
				// on-hand: only 10kg rice, transfer requests 100kg
				return {
					status: 200,
					data: {
						docs: [{ type: 'stock_ledger', item_id: 'item:rice', qty: '10', reason: 'receive' }]
					}
				};
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		await expect(
			repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001', DISPATCH_OPTS)
		).rejects.toMatchObject({ status: 422 });
	});

	it('dispatches: writes transfer_out ledger to the source shelter and updates central status', async () => {
		const doc = requestedTransfer();
		const putCalls: { path: string; body: unknown }[] = [];
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			// `ref_id` is checked first — it's unique to the ledgerAlreadyWritten idempotency
			// query, whereas `item_id` is present on both that query (post-fix) and the
			// balance-check query below.
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'ref_id')
			) {
				return { status: 200, data: { docs: [] } }; // not written yet
			}
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'item_id')
			) {
				return {
					status: 200,
					data: {
						docs: [{ type: 'stock_ledger', item_id: 'item:rice', qty: '500', reason: 'receive' }]
					}
				};
			}
			if (method === 'PUT') {
				putCalls.push({ path: decoded, body });
				return { status: 201, data: { ok: true, id: 'x', rev: '2-shipped' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		const result = await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001', DISPATCH_OPTS);

		expect(result.status).toBe('shipped');
		expect(result._rev).toBe('2-shipped');

		const ledgerPut = putCalls.find((c) => c.path.startsWith('/shelter_sh001/stock_ledger:'));
		expect(ledgerPut).toBeTruthy();
		expect(ledgerPut?.body).toMatchObject({ reason: 'transfer_out', qty: '-100' });

		const centralPut = putCalls.find((c) => c.path === `/central_ops/${TRANSFER_ID}`);
		expect(centralPut).toBeTruthy();
	});

	it('skips the ledger write on retry when it was already written (idempotency)', async () => {
		const doc = requestedTransfer();
		const ledgerPuts: unknown[] = [];
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'item_id')
			) {
				return {
					status: 200,
					data: {
						docs: [{ type: 'stock_ledger', item_id: 'item:rice', qty: '500', reason: 'receive' }]
					}
				};
			}
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'ref_id')
			) {
				// already written by a prior attempt before a 409 forced a retry
				return { status: 200, data: { docs: [{ _id: 'stock_ledger:existing' }] } };
			}
			if (method === 'PUT' && decoded.startsWith('/shelter_sh001/stock_ledger:')) {
				ledgerPuts.push(body);
				return { status: 201, data: { ok: true, id: 'x', rev: '1-a' } };
			}
			if (method === 'PUT' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 201, data: { ok: true, id: 'x', rev: '2-shipped' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001', DISPATCH_OPTS);

		expect(ledgerPuts).toHaveLength(0);
	});

	it('does not re-check stock sufficiency for a retry whose ledger already reduced the balance to exactly zero', async () => {
		// Regression test: a prior attempt wrote the transfer_out ledger (100kg dispatched,
		// draining stock to 0) but the final central_ops PUT failed (e.g. a 409), forcing a
		// retry. The retry's `assertSufficientStock` must not see the now-zero live balance and
		// wrongly reject an already-committed dispatch as "insufficient stock".
		const doc = requestedTransfer();
		const centralPuts: unknown[] = [];
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'ref_id')
			) {
				// already written by the prior attempt
				return { status: 200, data: { docs: [{ _id: 'stock_ledger:existing' }] } };
			}
			if (
				method === 'POST' &&
				decoded === '/shelter_sh001/_find' &&
				isFindWithField(body, 'item_id')
			) {
				// live balance already reflects the prior attempt's ledger write: 100 in, 100 out
				return {
					status: 200,
					data: {
						docs: [
							{ type: 'stock_ledger', item_id: 'item:rice', qty: '100', reason: 'receive' },
							{ type: 'stock_ledger', item_id: 'item:rice', qty: '-100', reason: 'transfer_out' }
						]
					}
				};
			}
			if (method === 'PUT' && decoded === `/central_ops/${TRANSFER_ID}`) {
				centralPuts.push(body);
				return { status: 201, data: { ok: true, id: 'x', rev: '2-shipped' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		const result = await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001', DISPATCH_OPTS);

		expect(result.status).toBe('shipped');
		expect(centralPuts).toHaveLength(1);
	});

	it('dispatches a multi-item transfer: writes a ledger entry for every item, not just the first', async () => {
		const doc = requestedTransfer({
			items: [
				{ item_id: 'item:rice', qty: '50', unit: 'kg' },
				{ item_id: 'item:beans', qty: '30', unit: 'kg' }
			]
		});
		const writtenLedgers: { item_id: unknown; ref_id: unknown; reason: unknown }[] = [];
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (method === 'POST' && decoded === '/shelter_sh001/_find') {
				const selector = (body as { selector: Record<string, unknown> }).selector;
				if ('ref_id' in selector) {
					// idempotency check — reflect what has actually been PUT so far, keyed on
					// item_id too, so item A's write can't shadow item B's check.
					const match = writtenLedgers.some(
						(l) =>
							l.ref_id === selector.ref_id &&
							l.item_id === selector.item_id &&
							l.reason === selector.reason
					);
					return { status: 200, data: { docs: match ? [{ _id: 'stock_ledger:existing' }] : [] } };
				}
				// balance check — plenty of stock for both items
				return {
					status: 200,
					data: {
						docs: [
							{ type: 'stock_ledger', item_id: 'item:rice', qty: '500', reason: 'receive' },
							{ type: 'stock_ledger', item_id: 'item:beans', qty: '500', reason: 'receive' }
						]
					}
				};
			}
			if (method === 'PUT' && decoded.startsWith('/shelter_sh001/stock_ledger:')) {
				const ledger = body as { item_id: unknown; ref_id: unknown; reason: unknown };
				writtenLedgers.push({
					item_id: ledger.item_id,
					ref_id: ledger.ref_id,
					reason: ledger.reason
				});
				return { status: 201, data: { ok: true, id: 'x', rev: '1-a' } };
			}
			if (method === 'PUT' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 201, data: { ok: true, id: 'x', rev: '2-shipped' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001', DISPATCH_OPTS);

		expect(writtenLedgers).toHaveLength(2);
		expect(writtenLedgers.map((l) => l.item_id).sort()).toEqual(['item:beans', 'item:rice']);
	});

	it('receives: writes transfer_in ledger to the destination shelter', async () => {
		const doc = requestedTransfer({
			status: 'shipped',
			timeline: {
				requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' },
				shipped: { at: '2026-08-22T06:00:00.000Z', by: 'Staff A' }
			}
		});
		const putCalls: { path: string; body: unknown }[] = [];
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (method === 'POST' && decoded === '/shelter_sh002/_find') {
				return { status: 200, data: { docs: [] } };
			}
			if (method === 'PUT') {
				putCalls.push({ path: decoded, body });
				return { status: 201, data: { ok: true, id: 'x', rev: '3-received' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH002');
		const result = await repo.transition(TRANSFER_ID, 'received', 'Staff C', 'SH002', {
			receivedItems: [{ item_id: 'item:rice', qty: 100 }]
		});

		expect(result.status).toBe('received');
		const ledgerPut = putCalls.find((c) => c.path.startsWith('/shelter_sh002/stock_ledger:'));
		expect(ledgerPut?.body).toMatchObject({ reason: 'transfer_in', qty: '100' });
	});

	it('cancels a requested transfer with no ledger writes', async () => {
		const doc = requestedTransfer();
		const putPaths: string[] = [];
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (method === 'PUT') {
				putPaths.push(decoded);
				return { status: 201, data: { ok: true, id: 'x', rev: '2-cancelled' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		const result = await repo.transition(TRANSFER_ID, 'cancelled', 'Staff A', 'SH001', {
			cancel_reason: 'ของไม่พร้อมส่ง'
		});

		expect(result.status).toBe('cancelled');
		expect(putPaths).toEqual([`/central_ops/${TRANSFER_ID}`]);
	});

	it('rejects a dispatch that arrives without a driver or plate (CR-089 FR-01)', async () => {
		const doc = requestedTransfer();
		const putPaths: string[] = [];
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (method === 'PUT') {
				putPaths.push(decoded);
				return { status: 201, data: { ok: true, id: 'x', rev: '2-x' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		await expect(repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001')).rejects.toThrow();

		// Nothing may be written — neither the status nor a stock deduction (CR-089 FR-01).
		expect(putPaths).toEqual([]);
	});

	it('disputes a requested transfer with no ledger writes (CR-089 FR-04)', async () => {
		const doc = requestedTransfer();
		const putPaths: string[] = [];
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (method === 'PUT') {
				putPaths.push(decoded);
				return { status: 201, data: { ok: true, id: 'x', rev: '2-disputed' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		const result = await repo.transition(TRANSFER_ID, 'disputed', 'Staff A', 'SH001', {
			dispute_reason: 'รอตรวจสอบยอดก่อน'
		});

		expect(result.status).toBe('disputed');
		expect(result.dispute_reason).toBe('รอตรวจสอบยอดก่อน');
		expect(result.timeline.disputed?.by).toBe('Staff A');
		expect(putPaths).toEqual([`/central_ops/${TRANSFER_ID}`]);
	});

	it('refuses a dispute driven by the destination shelter (CR-089 FR-06)', async () => {
		const doc = requestedTransfer();
		adminRaw.mockImplementation(async (path: string, method: string) => {
			if (method === 'GET' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH002');
		await expect(
			repo.transition(TRANSFER_ID, 'disputed', 'Staff C', 'SH002', {
				dispute_reason: 'ไม่เห็นด้วย'
			})
		).rejects.toMatchObject({ status: 403 });
	});

	it('resumes a disputed transfer back to requested (CR-089 FR-05)', async () => {
		const doc = requestedTransfer({
			status: 'disputed',
			dispute_reason: 'รอตรวจสอบยอดก่อน',
			timeline: {
				requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' },
				disputed: { at: '2026-08-22T06:00:00.000Z', by: 'Staff A' }
			}
		});
		adminRaw.mockImplementation(async (path: string, method: string) => {
			if (method === 'GET' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
				return { status: 200, data: doc };
			}
			if (method === 'PUT') return { status: 201, data: { ok: true, id: 'x', rev: '3-resumed' } };
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		const result = await repo.transition(TRANSFER_ID, 'requested', 'Staff A', 'SH001');

		expect(result.status).toBe('requested');
		// The last hold stays on record after resuming (CR-089 FR-05, FR-11).
		expect(result.dispute_reason).toBe('รอตรวจสอบยอดก่อน');
		expect(result.timeline.disputed?.at).toBe('2026-08-22T06:00:00.000Z');
	});

	it('surfaces a non-2xx PUT as TransferServerRepositoryError', async () => {
		adminRaw.mockImplementation(async (path: string, method: string) => {
			if (method === 'PUT' && decodeURIComponent(path).startsWith('/central_ops/stock_transfer:')) {
				return { status: 500, data: { error: 'boom' } };
			}
			return { status: 200, data: {} };
		});

		const repo = new TransferServerRepository('central_ops', 'SH001');
		await expect(
			repo.create(
				{
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
				},
				{ shelterCode: 'SH001', createdBy: 'Staff A' }
			)
		).rejects.toBeInstanceOf(TransferServerRepositoryError);
	});

	// --- CR-090 remove() / restore() ---

	describe('remove (CR-090)', () => {
		it('deletes with the stored rev and returns the tombstone rev plus the deleted body', async () => {
			const stored = requestedTransfer({ _rev: '3-current' });
			const calls: [string, string][] = [];
			adminRaw.mockImplementation(async (path: string, method: string) => {
				calls.push([decodeURIComponent(path), method]);
				if (method === 'GET' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
					return { status: 200, data: stored };
				}
				if (method === 'DELETE') {
					return { status: 200, data: { ok: true, id: TRANSFER_ID, rev: '4-tombstone' } };
				}
				return { status: 200, data: {} };
			});

			const repo = new TransferServerRepository('central_ops', 'SH001');
			const result = await repo.remove(TRANSFER_ID, 'SH001');

			expect(result.rev).toBe('4-tombstone');
			expect(result.doc).toEqual(stored);
			const del = calls.find(([, method]) => method === 'DELETE');
			expect(del?.[0]).toBe(`/central_ops/${TRANSFER_ID}?rev=3-current`);
		});

		it('rejects a delete of a transfer that is no longer `requested`', async () => {
			// CR-090 FR-03 — the status is re-read here, so hiding the button is not the gate.
			for (const status of ['shipped', 'received', 'cancelled', 'disputed'] as const) {
				adminRaw.mockImplementation(async (path: string, method: string) => {
					if (method === 'GET' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
						return { status: 200, data: requestedTransfer({ status }) };
					}
					return { status: 200, data: {} };
				});

				const repo = new TransferServerRepository('central_ops', 'SH001');
				await expect(repo.remove(TRANSFER_ID, 'SH001')).rejects.toMatchObject({
					status: 422
				});
				expect(adminRaw.mock.calls.every(([, method]) => method !== 'DELETE')).toBe(true);
				vi.clearAllMocks();
			}
		});

		it('rejects a delete driven by the destination shelter', async () => {
			adminRaw.mockImplementation(async (path: string, method: string) => {
				if (method === 'GET' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
					return { status: 200, data: requestedTransfer() };
				}
				return { status: 200, data: {} };
			});

			const repo = new TransferServerRepository('central_ops', 'SH002');
			await expect(repo.remove(TRANSFER_ID, 'SH002')).rejects.toMatchObject({ status: 403 });
			expect(adminRaw.mock.calls.every(([, method]) => method !== 'DELETE')).toBe(true);
		});

		it('404s when the transfer is already gone', async () => {
			adminRaw.mockImplementation(async () => ({ status: 404, data: { error: 'not_found' } }));
			const repo = new TransferServerRepository('central_ops', 'SH001');
			await expect(repo.remove(TRANSFER_ID, 'SH001')).rejects.toMatchObject({ status: 404 });
		});
	});

	describe('restore (CR-090)', () => {
		it('PUTs the body verbatim and never attaches a _rev', async () => {
			// The 2026-09-04 spike measured CouchDB 3.5.2: a rev-less PUT restores the document,
			// while attaching the tombstone rev returns 409 every time (FR-09).
			let putBody: Record<string, unknown> | undefined;
			adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
				if (method === 'PUT' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
					putBody = body as Record<string, unknown>;
					return { status: 201, data: { ok: true, id: TRANSFER_ID, rev: '5-restored' } };
				}
				return { status: 200, data: {} };
			});

			const deleted = requestedTransfer({ _rev: '4-tombstone' });
			const repo = new TransferServerRepository('central_ops', 'SH001');
			const restored = await repo.restore(deleted, 'SH001');

			expect(putBody).toBeDefined();
			expect(putBody).not.toHaveProperty('_rev');
			// FR-05/FR-08 — the envelope and the timeline must survive the round trip untouched.
			expect(putBody?.created_at).toBe(deleted.created_at);
			expect(putBody?.created_by).toBe(deleted.created_by);
			expect(putBody?.updated_at).toBe(deleted.updated_at);
			expect(putBody?.timeline).toEqual(deleted.timeline);
			expect(putBody?._id).toBe(TRANSFER_ID);
			expect(restored._rev).toBe('5-restored');
		});

		it('reports a 409 as a refusal to overwrite a live document', async () => {
			// FR-10's no-overwrite rule is enforced by CouchDB itself, not by a read-then-check.
			adminRaw.mockImplementation(async (path: string, method: string) => {
				if (method === 'PUT' && decodeURIComponent(path) === `/central_ops/${TRANSFER_ID}`) {
					return { status: 409, data: { error: 'conflict' } };
				}
				return { status: 200, data: {} };
			});

			const repo = new TransferServerRepository('central_ops', 'SH001');
			await expect(repo.restore(requestedTransfer(), 'SH001')).rejects.toMatchObject({
				status: 409
			});
		});

		it('rejects a body that is not `requested` or belongs to another shelter', async () => {
			adminRaw.mockImplementation(async () => ({ status: 200, data: {} }));
			const repo = new TransferServerRepository('central_ops', 'SH001');

			await expect(
				repo.restore(requestedTransfer({ status: 'shipped' }), 'SH001')
			).rejects.toMatchObject({ status: 403 });
			await expect(repo.restore(requestedTransfer(), 'SH002')).rejects.toMatchObject({
				status: 403
			});
			expect(adminRaw.mock.calls.every(([, method]) => method !== 'PUT')).toBe(true);
		});

		it('rejects a malformed body before it reaches CouchDB', async () => {
			adminRaw.mockImplementation(async () => ({ status: 200, data: {} }));
			const repo = new TransferServerRepository('central_ops', 'SH001');

			await expect(repo.restore({ type: 'stock_transfer' }, 'SH001')).rejects.toMatchObject({
				status: 422
			});
			expect(adminRaw.mock.calls.every(([, method]) => method !== 'PUT')).toBe(true);
		});
	});
});
