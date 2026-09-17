import { allDocsByType, getDoc, putDoc } from '$lib/db/couch-db';
import { now, type AuthorContext } from '$lib/db/model';
import { parseQty } from '$lib/utils/qty';
import {
	bulkReturnPoolDocSchema,
	createBulkReturnPool,
	type BulkReturnPool,
	type BulkReturnPoolInput,
	type BulkReturnPoolStatus
} from '../../domain/food-supplies';
import { NotFoundError, resolveShelterDbName, retryCas } from './shared';

export interface BulkReturnPoolListFilter {
	item_id?: string;
	status?: BulkReturnPoolStatus;
}

export interface BulkReturnPoolRepository {
	create(input: BulkReturnPoolInput | BulkReturnPool, ctx: AuthorContext): Promise<BulkReturnPool>;
	get(poolId: string): Promise<BulkReturnPool | null>;
	list(filter?: BulkReturnPoolListFilter): Promise<BulkReturnPool[]>;
	claimQuota(poolId: string, claimQty: string, ctx: AuthorContext): Promise<BulkReturnPool>;
	closePool(poolId: string, ctx: AuthorContext, notes?: string): Promise<BulkReturnPool>;
}

export class BulkReturnPoolRemoteRepository implements BulkReturnPoolRepository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async create(
		input: BulkReturnPoolInput | BulkReturnPool,
		ctx: AuthorContext
	): Promise<BulkReturnPool> {
		let doc: BulkReturnPool;
		if ('_id' in input && input.type === 'bulk_return_pool') {
			doc = bulkReturnPoolDocSchema.parse(input);
		} else {
			doc = createBulkReturnPool(input as BulkReturnPoolInput, ctx);
		}
		return putDoc(this.dbName, doc);
	}

	async get(poolId: string): Promise<BulkReturnPool | null> {
		const raw = await getDoc<BulkReturnPool>(this.dbName, poolId);
		if (!raw) return null;
		return bulkReturnPoolDocSchema.parse(raw);
	}

	async list(filter?: BulkReturnPoolListFilter): Promise<BulkReturnPool[]> {
		const docs = await allDocsByType<BulkReturnPool>(
			this.dbName,
			'bulk_return_pool',
			(d): d is BulkReturnPool =>
				typeof d === 'object' && d !== null && (d as { type?: string }).type === 'bulk_return_pool'
		);
		const parsed = docs.map((d) => bulkReturnPoolDocSchema.parse(d));
		return parsed.filter((pool) => {
			if (filter?.item_id && pool.item_id !== filter.item_id) return false;
			if (filter?.status && pool.status !== filter.status) return false;
			return true;
		});
	}

	async claimQuota(poolId: string, claimQty: string, ctx: AuthorContext): Promise<BulkReturnPool> {
		void ctx;
		return retryCas(async () => {
			const current = await this.get(poolId);
			if (!current) {
				throw new NotFoundError(`Bulk return pool ${poolId} not found`);
			}
			if (current.status !== 'ACTIVE') {
				throw new Error(`Bulk return pool ${poolId} is not ACTIVE (status: ${current.status})`);
			}

			const claimDec = parseQty(claimQty);
			if (claimDec.isNegative() || claimDec.isZero()) {
				throw new Error('claimQty must be a positive decimal quantity');
			}

			const currentQuotaDec = parseQty(current.unclaimed_quota);
			const remainingQuotaDec = currentQuotaDec.minus(claimDec);
			if (remainingQuotaDec.isNegative()) {
				throw new Error(
					`Insufficient unclaimed quota in bulk return pool ${poolId}: available ${current.unclaimed_quota}, requested ${claimQty}`
				);
			}

			const nextClaimed = parseQty(current.claimed_qty).plus(claimDec).toString();
			const nextStatus: BulkReturnPoolStatus = remainingQuotaDec.isZero() ? 'EXHAUSTED' : 'ACTIVE';

			const next = bulkReturnPoolDocSchema.parse({
				...current,
				_id: current._id,
				_rev: current._rev,
				shelter_code: current.shelter_code,
				claimed_qty: nextClaimed,
				unclaimed_quota: remainingQuotaDec.toString(),
				status: nextStatus,
				updated_at: now()
			});

			return putDoc(this.dbName, next);
		});
	}

	async closePool(poolId: string, ctx: AuthorContext, notes?: string): Promise<BulkReturnPool> {
		return retryCas(async () => {
			const current = await this.get(poolId);
			if (!current) {
				throw new NotFoundError(`Bulk return pool ${poolId} not found`);
			}
			if (current.status === 'CLOSED') {
				return current;
			}

			const next = bulkReturnPoolDocSchema.parse({
				...current,
				_id: current._id,
				_rev: current._rev,
				shelter_code: current.shelter_code,
				status: 'CLOSED' as const,
				closed_at: now(),
				closed_by: ctx.createdBy,
				...(notes ? { notes } : {}),
				updated_at: now()
			});

			return putDoc(this.dbName, next);
		});
	}
}
