// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

const allDocsByType = vi.fn();
vi.mock('$lib/db/couch-db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db/couch-db')>()),
	allDocsByType: (...args: unknown[]) => allDocsByType(...args)
}));

import { OperationsRemoteRepository } from './operations.remote';

const claim = (operation_id: string, item_id: string, lot_ref: string, qty: string) => ({
	operation_id,
	request_id: 'distribution_request:r1',
	batch_id: 'distribution_batch:b1',
	item_id,
	lot_ref,
	qty,
	claimed_at: '2026-11-05T00:00:00.000Z'
});

describe('OperationsRemoteRepository.listLotReservationClaims', () => {
	it('flattens pending claims of every reservation doc to item / lot / qty', async () => {
		allDocsByType.mockResolvedValueOnce([
			{
				_id: 'stock_lot_reservation:a',
				type: 'stock_lot_reservation',
				lot_ref: 'stock_ledger:l1',
				pending_claims: [
					claim('op1', 'item_master:net', 'stock_ledger:l1', '5'),
					claim('op2', 'item_master:net', 'stock_ledger:l1', '2.5')
				]
			},
			{
				_id: 'stock_lot_reservation:b',
				type: 'stock_lot_reservation',
				lot_ref: 'stock_ledger:l2',
				pending_claims: []
			}
		]);
		const claims = await new OperationsRemoteRepository('shelter_sh001').listLotReservationClaims();
		expect(claims).toEqual([
			{ item_id: 'item_master:net', lot_ref: 'stock_ledger:l1', qty: '5' },
			{ item_id: 'item_master:net', lot_ref: 'stock_ledger:l1', qty: '2.5' }
		]);
		expect(allDocsByType.mock.calls[0][1]).toBe('stock_lot_reservation');
	});
});
