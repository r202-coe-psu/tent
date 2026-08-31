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
		await expect(repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001')).rejects.toMatchObject(
			{ status: 404 }
		);
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
		await expect(repo.transition(TRANSFER_ID, 'shipped', 'Staff B', 'SH999')).rejects.toMatchObject(
			{ status: 403 }
		);
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
		await expect(repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001')).rejects.toMatchObject(
			{ status: 422 }
		);
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
		const result = await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001');

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
		await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001');

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
		const result = await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001');

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
		await repo.transition(TRANSFER_ID, 'shipped', 'Staff A', 'SH001');

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
		const result = await repo.transition(TRANSFER_ID, 'cancelled', 'Staff A', 'SH001');

		expect(result.status).toBe('cancelled');
		expect(putPaths).toEqual([`/central_ops/${TRANSFER_ID}`]);
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
});
