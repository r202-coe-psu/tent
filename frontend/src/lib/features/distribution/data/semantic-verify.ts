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
