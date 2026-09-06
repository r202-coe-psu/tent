import { addQty } from '$lib/utils/qty';
import { sha256Hex } from '$lib/db/hash';
import type { StockLedger } from '$lib/features/operations/domain/operations';
import type {
	DistributionBatch,
	DistributionBatchItem,
	DistributionAllocation,
	DistributionIssue,
	DistributionIssueIdempotency
} from '../domain/distribution';
import type { EligibilitySnapshot } from '../domain/eligibility';
import type { CloseBatchItemInput, ReconciliationRow } from '../domain/reconciliation';

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

export class IssueConflictError extends Error {
	constructor(message: string) {
		super(`IssueConflictError: ${message}`);
		this.name = 'IssueConflictError';
	}
}

export class IssueCapacityError extends Error {
	constructor(message: string) {
		super(`IssueCapacityError: ${message}`);
		this.name = 'IssueCapacityError';
	}
}

export class RecipientNotActiveError extends Error {
	constructor(message: string) {
		super(`RecipientNotActiveError: ${message}`);
		this.name = 'RecipientNotActiveError';
	}
}

export class DistributionEligibilityError extends Error {
	constructor(message: string) {
		super(`DistributionEligibilityError: ${message}`);
		this.name = 'DistributionEligibilityError';
	}
}

export class IssueInFlightError extends Error {
	constructor(message: string) {
		super(`IssueInFlightError: ${message}`);
		this.name = 'IssueInFlightError';
	}
}

export class BatchClosingConflictError extends Error {
	constructor(message: string) {
		super(`BatchClosingConflictError: ${message}`);
		this.name = 'BatchClosingConflictError';
	}
}

/** Computes the deterministic SHA-256 reservation document ID for a physical lot. */
export async function makeLotReservationDocId(lotRef: string): Promise<string> {
	const hash = await sha256Hex(lotRef);
	return `stock_lot_reservation:${hash}`;
}

/** Computes the deterministic SHA-256 idempotency coordination document ID for a distribution issue. */
export async function makeIssueIdempotencyDocId(
	batchId: string,
	idempotencyKey: string
): Promise<string> {
	const hash = await sha256Hex(`${batchId}:${idempotencyKey}`);
	return `distribution_issue_idempotency:${hash}`;
}

/** Computes the deterministic SHA-256 capacity coordination document ID for a batch item. */
export async function makeIssueCapacityDocId(batchId: string, itemId: string): Promise<string> {
	const hash = await sha256Hex(`${batchId}:${itemId}`);
	return `distribution_issue_capacity:${hash}`;
}

/** Computes the deterministic SHA-256 batch-wide Issue/Close coordination gate ID. */
export async function makeIssueGateDocId(batchId: string): Promise<string> {
	const hash = await sha256Hex(batchId);
	return `distribution_issue_gate:${hash}`;
}

/** Computes the deterministic SHA-256 one-time guard document ID for an evacuee item receipt. */
export async function makeOneTimeGuardDocId(evacueeId: string, itemId: string): Promise<string> {
	const hash = await sha256Hex(`${evacueeId}:${itemId}`);
	return `distribution_one_time_guard:${hash}`;
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

/** Asserts that an existing idempotency coordination doc matches expected semantic intent. */
export function assertSemanticIdempotencyMatch(
	existing: DistributionIssueIdempotency,
	expected: {
		batch_id: string;
		idempotency_key: string;
		evacuee_id: string;
		item_id: string;
		qty: string;
		repeat_override_reason?: string;
		repeat_override_note?: string;
		shelter_code: string;
	}
): void {
	if (
		existing.type !== 'distribution_issue_idempotency' ||
		existing.batch_id !== expected.batch_id ||
		existing.idempotency_key !== expected.idempotency_key ||
		existing.evacuee_id !== expected.evacuee_id ||
		existing.item_id !== expected.item_id ||
		existing.qty !== expected.qty ||
		existing.repeat_override_reason !== expected.repeat_override_reason ||
		existing.repeat_override_note !== expected.repeat_override_note ||
		existing.shelter_code !== expected.shelter_code
	) {
		throw new IssueConflictError(
			`Existing idempotency mapping ${existing._id} does not match expected semantic intent`
		);
	}
}

export function assertEligibilitySnapshotInvariant(
	snapshot: EligibilitySnapshot,
	distributionType: string,
	repeatOverrideReason?: string
): void {
	if (
		snapshot.distribution_type !== distributionType ||
		!snapshot.eligible ||
		snapshot.had_previous_receipt !== snapshot.previous_receipt_count > 0
	) {
		throw new IntegrityError('Persisted distribution issue has an invalid eligibility snapshot');
	}
	if (distributionType === 'consumable') {
		if (snapshot.decision !== 'consumable' || snapshot.repeat_override_reason) {
			throw new IntegrityError('Consumable issue has an invalid eligibility snapshot');
		}
		return;
	}
	if (snapshot.decision === 'first_receipt') {
		if (
			snapshot.had_previous_receipt ||
			snapshot.previous_receipt_count !== 0 ||
			snapshot.repeat_override_reason ||
			repeatOverrideReason
		) {
			throw new IntegrityError('First-receipt issue has an invalid eligibility snapshot');
		}
		return;
	}
	if (
		snapshot.decision !== 'repeat_override' ||
		!snapshot.had_previous_receipt ||
		snapshot.previous_receipt_count <= 0 ||
		(snapshot.repeat_override_reason !== 'lost' && snapshot.repeat_override_reason !== 'damaged') ||
		snapshot.repeat_override_reason !== repeatOverrideReason
	) {
		throw new IntegrityError('Repeat-override issue has an invalid eligibility snapshot');
	}
}

/** Asserts that an existing distribution issue matches expected semantic invariant payload. */
export function assertSemanticIssueMatch(
	existing: DistributionIssue,
	expected: {
		_id: string;
		batch_id: string;
		evacuee_id: string;
		item_id: string;
		qty: string;
		unit: string;
		distribution_type_snapshot: string;
		repeat_override_reason?: string;
		repeat_override_note?: string;
		idempotency_key: string;
		shelter_code: string;
		eligibility_snapshot?: EligibilitySnapshot;
	}
): void {
	assertEligibilitySnapshotInvariant(
		existing.eligibility_snapshot,
		existing.distribution_type_snapshot,
		existing.repeat_override_reason
	);
	if (
		existing._id !== expected._id ||
		existing.type !== 'distribution_issue' ||
		existing.batch_id !== expected.batch_id ||
		existing.evacuee_id !== expected.evacuee_id ||
		existing.item_id !== expected.item_id ||
		existing.qty !== expected.qty ||
		existing.unit !== expected.unit ||
		existing.distribution_type_snapshot !== expected.distribution_type_snapshot ||
		existing.repeat_override_reason !== expected.repeat_override_reason ||
		existing.repeat_override_note !== expected.repeat_override_note ||
		existing.idempotency_key !== expected.idempotency_key ||
		existing.shelter_code !== expected.shelter_code
	) {
		throw new IntegrityError(
			`Existing distribution issue ${existing._id} does not match expected semantic invariant payload`
		);
	}
	if (
		expected.eligibility_snapshot &&
		JSON.stringify(existing.eligibility_snapshot) !== JSON.stringify(expected.eligibility_snapshot)
	) {
		throw new IntegrityError(
			`Existing distribution issue ${existing._id} eligibility snapshot changed`
		);
	}
}

/** Asserts that incoming reconciliation input for a retry matches the already persisted closing reconciliation. */
export function assertSemanticClosingMatch(
	existing: readonly ReconciliationRow[],
	inputReconciliation: readonly CloseBatchItemInput[]
): void {
	if (!existing || existing.length === 0) {
		throw new IntegrityError('Existing batch reconciliation is missing or empty');
	}
	const existingByLot = new Map(existing.map((r) => [r.lot_ref, r]));
	const existingTotalsByItem = new Map<
		string,
		{ damaged: string; lost: string; damaged_note?: string; lost_note?: string }
	>();
	for (const row of existing) {
		const curr = existingTotalsByItem.get(row.item_id) ?? { damaged: '0', lost: '0' };
		existingTotalsByItem.set(row.item_id, {
			damaged: addQty(curr.damaged, row.damaged_qty),
			lost: addQty(curr.lost, row.lost_qty),
			damaged_note: row.damaged_note ?? curr.damaged_note,
			lost_note: row.lost_note ?? curr.lost_note
		});
	}

	for (const input of inputReconciliation) {
		const inputDamaged = input.damaged_qty ?? '0';
		const inputLost = input.lost_qty ?? '0';

		if (input.lot_ref) {
			const match = existingByLot.get(input.lot_ref);
			if (!match) {
				throw new BatchClosingConflictError(
					`Input lot_ref ${input.lot_ref} is not present in existing closing batch reconciliation`
				);
			}
			if (match.item_id !== input.item_id) {
				throw new BatchClosingConflictError(
					`Input item_id ${input.item_id} does not match existing closing reconciliation for lot ${input.lot_ref}`
				);
			}
			if (match.damaged_qty !== inputDamaged || match.lost_qty !== inputLost) {
				throw new BatchClosingConflictError(
					`Input damaged/lost quantities for lot ${input.lot_ref} conflict with persisted closing batch reconciliation`
				);
			}
			if (
				(input.damaged_note && match.damaged_note !== input.damaged_note) ||
				(input.lost_note && match.lost_note !== input.lost_note)
			) {
				throw new BatchClosingConflictError(
					`Input notes for lot ${input.lot_ref} conflict with persisted closing batch reconciliation`
				);
			}
		} else {
			// Item-level comparison
			const itemTotals = existingTotalsByItem.get(input.item_id);
			if (!itemTotals) {
				throw new BatchClosingConflictError(
					`Input item_id ${input.item_id} is not present in existing closing batch reconciliation`
				);
			}
			if (itemTotals.damaged !== inputDamaged || itemTotals.lost !== inputLost) {
				throw new BatchClosingConflictError(
					`Input damaged/lost quantities for item ${input.item_id} conflict with persisted closing batch reconciliation`
				);
			}
			if (
				(input.damaged_note && itemTotals.damaged_note !== input.damaged_note) ||
				(input.lost_note && itemTotals.lost_note !== input.lost_note)
			) {
				throw new BatchClosingConflictError(
					`Input notes for item ${input.item_id} conflict with persisted closing batch reconciliation`
				);
			}
		}
	}
}
