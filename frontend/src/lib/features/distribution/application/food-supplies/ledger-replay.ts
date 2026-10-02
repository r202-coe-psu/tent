import type { LedgerReason, StockLedger } from '$lib/features/operations';
import { parseQty } from '$lib/utils/qty';
import { StockIntegrityError } from './errors';

/** Required immutable facts for accepting a deterministic StockLedger replay. */
export interface LedgerReplayExpectation {
	id: StockLedger['_id'];
	schemaVersion: StockLedger['schema_v'];
	shelterCode: StockLedger['shelter_code'];
	reason: LedgerReason;
	refId: StockLedger['ref_id'];
	itemId: StockLedger['item_id'];
	qty: StockLedger['qty'];
	unit: StockLedger['unit'];
	lotRef: StockLedger['lot_ref'];
}

/** Fails closed unless an existing deterministic ledger row matches every shared immutable fact. */
export function assertLedgerReplayBase(
	actual: StockLedger,
	expected: LedgerReplayExpectation,
	mismatchMessage: string
): void {
	if (
		actual._id !== expected.id ||
		actual.type !== 'stock_ledger' ||
		actual.schema_v !== expected.schemaVersion ||
		actual.shelter_code !== expected.shelterCode ||
		actual.reason !== expected.reason ||
		actual.ref_id !== expected.refId ||
		actual.item_id !== expected.itemId ||
		actual.unit !== expected.unit ||
		!parseQty(actual.qty).eq(expected.qty) ||
		actual.lot_ref !== expected.lotRef
	) {
		throw new StockIntegrityError(mismatchMessage);
	}
}
