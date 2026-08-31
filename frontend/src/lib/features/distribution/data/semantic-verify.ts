import { sha256Hex } from '$lib/db/hash';
import type { StockLedger } from '$lib/features/operations/domain/operations';
import type {
	DistributionBatch,
	DistributionBatchItem,
	DistributionAllocation
} from '../domain/distribution';

export class IntegrityError extends Error {
	constructor(message: string) {
		super(`IntegrityError: ${message}`);
		this.name = 'IntegrityError';
	}
}

export class ApprovalConflictError extends Error {
	constructor(message: string) {
		super(`ApprovalConflictError: ${message}`);
		this.name = 'ApprovalConflictError';
	}
}

export class InsufficientStockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InsufficientStockError';
	}
}

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

/** Computes the deterministic SHA-256 reservation document ID for a physical lot. */
export async function makeLotReservationDocId(lotRef: string): Promise<string> {
	const hash = await sha256Hex(lotRef);
	return `stock_lot_reservation:${hash}`;
}

/** Asserts that an existing deterministic stock ledger semantically matches expected invariant payload. */
export function assertSemanticLedgerMatch(
	existing: StockLedger,
	expected: {
		_id: string;
		item_id: string;
		qty: string;
		unit: string;
		reason: 'distribute';
		ref_id: string;
		lot_ref: string;
		shelter_code: string;
	}
): void {
	if (
		existing._id !== expected._id ||
		existing.type !== 'stock_ledger' ||
		existing.reason !== expected.reason ||
		existing.item_id !== expected.item_id ||
		existing.qty !== expected.qty ||
		existing.unit !== expected.unit ||
		existing.ref_id !== expected.ref_id ||
		existing.lot_ref !== expected.lot_ref ||
		existing.shelter_code !== expected.shelter_code
	) {
		throw new IntegrityError(
			`Existing deterministic ledger ${existing._id} does not match expected invariant payload`
		);
	}
}

/** Asserts that an existing deterministic batch matches the canonical allocation plan. */
export function assertSemanticBatchMatch(
	existing: DistributionBatch,
	expected: {
		_id: string;
		request_id: string;
		shelter_code: string;
		items: DistributionBatchItem[];
		allocations: DistributionAllocation[];
	}
): void {
	if (
		existing._id !== expected._id ||
		existing.type !== 'distribution_batch' ||
		existing.request_id !== expected.request_id ||
		existing.shelter_code !== expected.shelter_code ||
		JSON.stringify(existing.items) !== JSON.stringify(expected.items) ||
		JSON.stringify(existing.allocations) !== JSON.stringify(expected.allocations)
	) {
		throw new IntegrityError(
			`Existing deterministic batch ${existing._id} does not match expected canonical allocation plan`
		);
	}
}
