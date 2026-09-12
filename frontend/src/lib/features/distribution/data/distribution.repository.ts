import type { AuthorContext } from '$lib/db/model';
import type {
	DistributionRequest,
	DistributionRequestInput,
	DistributionRequestStatus,
	DistributionBatch,
	DistributionBatchStatus
} from '../domain/distribution';

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
}
