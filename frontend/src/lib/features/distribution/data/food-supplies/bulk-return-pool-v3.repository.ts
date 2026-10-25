import { allDocsByType, getDoc, putDoc, putDocStrict } from '$lib/db/couch-db';
import { now } from '$lib/db/model';
import {
	assertPoolTransition,
	bulkReturnPoolV3DocSchema,
	BULK_RETURN_POOL_V3_SCHEMA_V,
	type BulkReturnPoolV3
} from '../../domain/food-supplies';
import { parseDocsOrSkip, type SkippedDoc } from './parse-or-skip';
import { NotFoundError, resolveShelterDbName, retryCas } from './shared';

/**
 * #658/#659 — repository for schema_v 3 `bulk_return_pool` headers. Legacy v1/v2 pools share the
 * doc type but are ignored here (they are handled by `BulkReturnPoolRepository`).
 */
export interface BulkReturnPoolV3Repository {
	/** Put-if-absent: throws ConflictError when the id already exists. */
	create(pool: BulkReturnPoolV3): Promise<BulkReturnPoolV3>;
	/** `null` when the doc is missing or is a legacy (non-v3) pool. */
	get(poolId: string): Promise<BulkReturnPoolV3 | null>;
	/** All v3 pools (legacy v1/v2 ignored), unsorted. */
	list(): Promise<BulkReturnPoolV3[]>;
	/** Like `list`, plus the v3 pool docs left out because they failed validation. */
	listWithSkipped(): Promise<{ items: BulkReturnPoolV3[]; skipped: SkippedDoc[] }>;
	/** CAS write of `pool` (must carry the `_rev` it was read at); ConflictError when stale. */
	update(pool: BulkReturnPoolV3): Promise<BulkReturnPoolV3>;
	/**
	 * Read-modify-write with bounded retry on conflict. The mutator may return `current` itself to
	 * signal "nothing to write". Any other result is validated with `assertPoolTransition`.
	 */
	mutateCAS(
		poolId: string,
		mutator: (current: BulkReturnPoolV3) => BulkReturnPoolV3
	): Promise<BulkReturnPoolV3>;
}

const isPoolDocV3 = (d: unknown): d is BulkReturnPoolV3 =>
	typeof d === 'object' &&
	d !== null &&
	(d as { type?: string }).type === 'bulk_return_pool' &&
	(d as { schema_v?: number }).schema_v === BULK_RETURN_POOL_V3_SCHEMA_V;

export class BulkReturnPoolV3RemoteRepository implements BulkReturnPoolV3Repository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async create(pool: BulkReturnPoolV3): Promise<BulkReturnPoolV3> {
		const doc = bulkReturnPoolV3DocSchema.parse(pool) as BulkReturnPoolV3;
		return putDocStrict(this.dbName, doc);
	}

	async get(poolId: string): Promise<BulkReturnPoolV3 | null> {
		const raw = await getDoc<BulkReturnPoolV3>(this.dbName, poolId);
		if (!raw || !isPoolDocV3(raw)) return null;
		return bulkReturnPoolV3DocSchema.parse(raw) as BulkReturnPoolV3;
	}

	async list(): Promise<BulkReturnPoolV3[]> {
		return (await this.listWithSkipped()).items;
	}

	async listWithSkipped(): Promise<{ items: BulkReturnPoolV3[]; skipped: SkippedDoc[] }> {
		const docs = await allDocsByType<BulkReturnPoolV3>(
			this.dbName,
			'bulk_return_pool',
			isPoolDocV3
		);
		return parseDocsOrSkip<BulkReturnPoolV3>(docs, bulkReturnPoolV3DocSchema);
	}

	async update(pool: BulkReturnPoolV3): Promise<BulkReturnPoolV3> {
		if (!pool._rev) throw new Error(`bulk_return_pool ${pool._id} update requires _rev`);
		const doc = bulkReturnPoolV3DocSchema.parse(pool) as BulkReturnPoolV3;
		return putDoc(this.dbName, doc);
	}

	async mutateCAS(
		poolId: string,
		mutator: (current: BulkReturnPoolV3) => BulkReturnPoolV3
	): Promise<BulkReturnPoolV3> {
		return retryCas(async () => {
			const current = await this.get(poolId);
			if (!current) throw new NotFoundError(poolId);
			const computed = mutator(current);
			if (computed === current) return current;
			const next = bulkReturnPoolV3DocSchema.parse({
				...computed,
				_id: current._id,
				_rev: current._rev,
				shelter_code: current.shelter_code,
				updated_at: now()
			}) as BulkReturnPoolV3;
			assertPoolTransition(current, next);
			return this.update(next);
		});
	}
}
