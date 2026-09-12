import { sha256Hex } from '$lib/db/hash';
import type { StockLedger } from '$lib/features/operations/domain/operations';
import {
	stockLotReservationDocSchema,
	type DistributionBatch,
	type DistributionBatchItem,
	type DistributionAllocation,
	type StockLotReservation
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
		reason: 'distribute' | 'distribution_return';
		ref_id: string;
		lot_ref: string;
		shelter_code: string;
		occurred_at?: string;
		lot?: StockLedger['lot'];
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
		existing.shelter_code !== expected.shelter_code ||
		(expected.occurred_at !== undefined && existing.occurred_at !== expected.occurred_at)
	) {
		throw new IntegrityError(
			`Existing deterministic ledger ${existing._id} does not match expected invariant payload`
		);
	}
	if (expected.lot && JSON.stringify(existing.lot) !== JSON.stringify(expected.lot)) {
		throw new IntegrityError(
			`Existing deterministic ledger ${existing._id} lot metadata does not match expected allocation snapshot`
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

/** Asserts that a persisted stock lot reservation parses through the Domain schema and semantically matches expected lot and shelter scope. */
export function assertSemanticReservationMatch(
	rawDoc: unknown,
	expected: {
		_id: string;
		lot_ref: string;
		shelter_code?: string;
	}
): StockLotReservation {
	const parsed = stockLotReservationDocSchema.safeParse(rawDoc);
	if (!parsed.success) {
		throw new IntegrityError(
			`Persisted stock lot reservation ${expected._id} is malformed: ${parsed.error.message}`
		);
	}
	const doc = parsed.data as StockLotReservation;
	if (doc._id !== expected._id) {
		throw new IntegrityError(
			`Reservation document ID mismatch: expected ${expected._id}, got ${doc._id}`
		);
	}
	if (doc.lot_ref !== expected.lot_ref) {
		throw new IntegrityError(
			`Reservation ${expected._id} lot_ref mismatch: expected ${expected.lot_ref}, got ${doc.lot_ref}`
		);
	}
	if (expected.shelter_code && doc.shelter_code !== expected.shelter_code) {
		throw new IntegrityError(
			`Reservation ${expected._id} shelter_code mismatch: expected ${expected.shelter_code}, got ${doc.shelter_code}`
		);
	}
	return doc;
}
