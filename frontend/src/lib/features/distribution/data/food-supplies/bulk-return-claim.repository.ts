import { getDoc, putDoc } from '$lib/db/couch-db';
import { now, type AuthorContext } from '$lib/db/model';
import {
	assertBulkReturnClaimTransition,
	bulkReturnClaimDocSchema,
	type BulkReturnClaim,
	type BulkReturnClaimStatus
} from '../../domain/food-supplies';
import { NotFoundError, resolveShelterDbName, retryCas } from './shared';

export interface BulkReturnClaimRepository {
	create(claim: BulkReturnClaim): Promise<BulkReturnClaim>;
	get(claimId: string): Promise<BulkReturnClaim | null>;
	mutateStatusCAS(
		claimId: string,
		targetStatus: BulkReturnClaimStatus,
		notesOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<BulkReturnClaim>;
	reinitializeCAS(
		claimId: string,
		input: {
			operation_id: string;
			bulk_pool_id: string;
			claimed_qty: string;
			notes?: string;
		},
		ctx?: AuthorContext
	): Promise<BulkReturnClaim>;
	mutateCAS(
		claimId: string,
		mutator: (current: BulkReturnClaim) => BulkReturnClaim
	): Promise<BulkReturnClaim>;
}

export class BulkReturnClaimRemoteRepository implements BulkReturnClaimRepository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async create(claim: BulkReturnClaim): Promise<BulkReturnClaim> {
		const doc = bulkReturnClaimDocSchema.parse(claim);
		return putDoc(this.dbName, doc);
	}

	async get(claimId: string): Promise<BulkReturnClaim | null> {
		const raw = await getDoc<BulkReturnClaim>(this.dbName, claimId);
		if (!raw) return null;
		return bulkReturnClaimDocSchema.parse(raw);
	}

	async mutateCAS(
		claimId: string,
		mutator: (current: BulkReturnClaim) => BulkReturnClaim
	): Promise<BulkReturnClaim> {
		return retryCas(async () => {
			const current = await this.get(claimId);
			if (!current) {
				throw new NotFoundError(`Bulk return claim ${claimId} not found`);
			}
			const next = mutator(current);
			assertBulkReturnClaimTransition(current, next);
			return putDoc(this.dbName, next);
		});
	}

	async mutateStatusCAS(
		claimId: string,
		targetStatus: BulkReturnClaimStatus,
		notesOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<BulkReturnClaim> {
		void maybeCtx;
		const notes = typeof notesOrCtx === 'string' ? notesOrCtx : undefined;
		return this.mutateCAS(claimId, (current) => {
			if (current.status === targetStatus) {
				return current;
			}
			return bulkReturnClaimDocSchema.parse({
				...current,
				status: targetStatus,
				...(notes !== undefined ? { notes } : {}),
				updated_at: now()
			});
		});
	}

	async reinitializeCAS(
		claimId: string,
		input: {
			operation_id: string;
			bulk_pool_id: string;
			claimed_qty: string;
			notes?: string;
		},
		ctx?: AuthorContext
	): Promise<BulkReturnClaim> {
		void ctx;
		return this.mutateCAS(claimId, (current) => {
			if (current.status !== 'ABORTED') {
				throw new Error(
					`Cannot reinitialize claim ${claimId} in status ${current.status}; must be ABORTED`
				);
			}
			return bulkReturnClaimDocSchema.parse({
				...current,
				operation_id: input.operation_id,
				bulk_pool_id: input.bulk_pool_id,
				claimed_qty: input.claimed_qty,
				status: 'CLAIM_INTENT' as const,
				notes: input.notes ?? current.notes,
				updated_at: now()
			});
		});
	}
}
