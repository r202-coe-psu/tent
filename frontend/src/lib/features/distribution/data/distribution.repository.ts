import type { AuthorContext } from '$lib/db/model';
import type {
	DistributionRequest,
	DistributionRequestInput,
	DistributionRequestStatus,
	DistributionBatch,
	DistributionBatchStatus,
	DistributionIssue
} from '../domain/distribution';
import type { RepeatOverrideReason } from '../domain/eligibility';
import type { CloseBatchInput } from '../domain/reconciliation';

export interface DistributionAllocationInput {
	item_id: string;
	lot_ref: string;
	qty: string;
	lot?: {
		expiry?: string;
		note?: string;
		lot_no?: string;
		storage_zone?: string;
	};
}

export interface CreateDistributionIssueInput {
	batch_id: string;
	evacuee_id: string;
	item_id: string;
	qty: string;
	idempotency_key: string;
	repeat_override_reason?: RepeatOverrideReason;
	repeat_override_note?: string;
	distributed_at?: string;
}

export interface DistributionRecipient {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string;
	current_stay: {
		status: 'active';
		zone: string | null;
	};
}

export interface DistributionRepository {
	createRequest(input: DistributionRequestInput, ctx: AuthorContext): Promise<DistributionRequest>;
	getRequest(id: string, ctx: AuthorContext): Promise<DistributionRequest | null>;
	listRequests(
		status: DistributionRequestStatus | undefined,
		ctx: AuthorContext
	): Promise<DistributionRequest[]>;
	cancelRequest(requestId: string, ctx: AuthorContext): Promise<DistributionRequest>;
	approveRequest(
		requestId: string,
		allocations: DistributionAllocationInput[],
		ctx: AuthorContext
	): Promise<DistributionBatch>;
	rejectRequest(
		requestId: string,
		reason: string,
		ctx: AuthorContext
	): Promise<DistributionRequest>;
	getBatch(id: string, ctx: AuthorContext): Promise<DistributionBatch | null>;
	getBatches(batchIds: readonly string[], ctx: AuthorContext): Promise<DistributionBatch[]>;
	listBatches(
		status: DistributionBatchStatus | undefined,
		ctx: AuthorContext
	): Promise<DistributionBatch[]>;
	closeBatch(
		batchId: string,
		input: CloseBatchInput,
		ctx: AuthorContext
	): Promise<DistributionBatch>;

	listActiveRecipients(ctx: AuthorContext, search?: string): Promise<DistributionRecipient[]>;
	getRecipient(id: string, ctx: AuthorContext): Promise<DistributionRecipient | null>;
	createIssue(input: CreateDistributionIssueInput, ctx: AuthorContext): Promise<DistributionIssue>;
	getIssue(id: string): Promise<DistributionIssue | null>;
	listIssuesByBatch(batchId: string): Promise<DistributionIssue[]>;
}
