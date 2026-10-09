import { describe, it, expect } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { qtyNeg } from '$lib/utils/qty';
import { createStockLedger, type StockLedger } from '$lib/features/operations';
import { assertLedgerReplayBase, type LedgerReplayExpectation } from './ledger-replay';
import { StockIntegrityError } from './errors';

const CTX: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'wh_user',
	roles: ['shelter:SH001', 'warehouse_staff']
};

function ledger(): StockLedger {
	return createStockLedger(
		{
			item_id: 'item:soup',
			qty: qtyNeg('20'),
			unit: 'piece',
			reason: 'distribute',
			ref_id: 'requisition_ticket:t1',
			lot_ref: 'stock_ledger:lot1',
			occurred_at: '2026-09-17T12:00:00.000Z'
		},
		CTX,
		'01HZZZZZZZZZZZZZZZZZZZZZZZ'
	);
}

function expectation(row: StockLedger): LedgerReplayExpectation {
	return {
		id: row._id,
		schemaVersion: row.schema_v,
		shelterCode: row.shelter_code,
		reason: row.reason,
		refId: row.ref_id,
		itemId: row.item_id,
		qty: row.qty,
		unit: row.unit,
		lotRef: row.lot_ref
	};
}

const MISMATCH = 'replay mismatch';

describe('assertLedgerReplayBase — schema_v tolerance (CR-143 FR-C4)', () => {
	it('accepts a replay of the same schema_v', () => {
		const row = ledger();
		expect(() => assertLedgerReplayBase(row, expectation(row), MISMATCH)).not.toThrow();
	});

	it('accepts a row persisted at an older schema_v than the current writer stamps', () => {
		const current = ledger();
		const persisted = { ...current, schema_v: 5 as const };
		expect(() =>
			assertLedgerReplayBase(persisted, { ...expectation(current), schemaVersion: 6 }, MISMATCH)
		).not.toThrow();
	});

	it('refuses a row newer than the current writer', () => {
		const current = ledger();
		const persisted = { ...current, schema_v: 6 as const };
		expect(() =>
			assertLedgerReplayBase(persisted, { ...expectation(current), schemaVersion: 5 }, MISMATCH)
		).toThrow(StockIntegrityError);
	});

	it('still fails closed on a real fact mismatch even when schema_v is older', () => {
		const current = ledger();
		const persisted = { ...current, schema_v: 5 as const, item_id: 'item:other' };
		expect(() =>
			assertLedgerReplayBase(persisted, { ...expectation(current), schemaVersion: 6 }, MISMATCH)
		).toThrow(StockIntegrityError);
	});
});
