import { allDocsByIds, allDocsByType, getDoc, putDoc } from '$lib/db/couch-db';
import { now, type AuthorContext } from '$lib/db/model';
import { parseQty, qtyLte } from '$lib/utils/qty';
import {
	assertDistributionLogIssuanceImmutable,
	assertDistributionLogCanBeVoided,
	createDistributionLog,
	distributionLogDocSchema,
	type DistributionLog,
	type DistributionLogInput,
	type DistributionLogStatus,
	type ReturnCondition
} from '../../domain/food-supplies';
import { parseDocsOrSkip, type SkippedDoc } from './parse-or-skip';
import { NotFoundError, resolveShelterDbName, retryCas } from './shared';

/** Ids per `_all_docs` keys request in `getMany`. */
const GET_MANY_CHUNK_SIZE = 100;

export interface DistributionLogListFilter {
	ticket_id?: string;
	recipient_id?: string | null;
	item_id?: string;
	status?: DistributionLogStatus;
	is_returnable?: boolean;
}

/**
 * Whether a malformed raw doc could match `filter`. A filtered field that cannot be read (wrong type
 * or absent) counts as matching: it may be the very doc the caller is looking for.
 */
function rawMatchesFilter(raw: unknown, filter?: DistributionLogListFilter): boolean {
	if (!filter) return true;
	const doc = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const stringField = (key: 'ticket_id' | 'item_id' | 'status', want: string | undefined) =>
		!want || typeof doc[key] !== 'string' || doc[key] === want;
	if (!stringField('ticket_id', filter.ticket_id)) return false;
	if (!stringField('item_id', filter.item_id)) return false;
	if (!stringField('status', filter.status)) return false;
	if (
		filter.is_returnable !== undefined &&
		typeof doc.is_returnable === 'boolean' &&
		doc.is_returnable !== filter.is_returnable
	)
		return false;
	if (filter.recipient_id !== undefined) {
		const recipient = doc.recipient_id;
		const readable = recipient === null || typeof recipient === 'string';
		if (readable && recipient !== filter.recipient_id) return false;
	}
	return true;
}

export type PhysicalReturnReason = 'routine' | 'bulk_dropoff';
export type LoanResolutionReason = 'lost' | 'waived';

export interface RecordReturnInput {
	qty_returned: string;
	condition_on_return?: ReturnCondition;
	clear_reason: PhysicalReturnReason;
	bulk_pool_id?: string;
	notes?: string;
}

export interface RecordClearInput {
	clear_reason: LoanResolutionReason;
	notes: string;
}

export interface DistributionLogRepository {
	create(
		logInput: DistributionLogInput | DistributionLog,
		ctx: AuthorContext
	): Promise<DistributionLog>;
	get(logId: string): Promise<DistributionLog | null>;
	/** Valid logs matching `filter`; malformed docs are skipped (see `listWithSkipped`). */
	list(filter?: DistributionLogListFilter): Promise<DistributionLog[]>;
	/**
	 * Like `list`, plus the malformed docs that could match `filter` (matched on their raw fields; an
	 * unreadable filtered field counts as matching). Write paths use it to fail closed.
	 */
	listWithSkipped(
		filter?: DistributionLogListFilter
	): Promise<{ items: DistributionLog[]; skipped: SkippedDoc[] }>;
	/**
	 * Batch get by id (`_all_docs` keys, chunked). Ids with no doc are simply absent from `items`;
	 * malformed docs are reported in `skipped` instead of failing the read.
	 */
	getMany(ids: readonly string[]): Promise<{ items: DistributionLog[]; skipped: SkippedDoc[] }>;
	mutateLogCAS(
		logId: string,
		mutator: (current: DistributionLog) => DistributionLog
	): Promise<DistributionLog>;
	recordReturn(
		logId: string,
		input: RecordReturnInput,
		ctx: AuthorContext
	): Promise<DistributionLog>;
	recordClear(logId: string, input: RecordClearInput, ctx: AuthorContext): Promise<DistributionLog>;
	recordVoid(logId: string, ctx: AuthorContext, notes?: string): Promise<DistributionLog>;
}

export class DistributionLogRemoteRepository implements DistributionLogRepository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async create(
		logInput: DistributionLogInput | DistributionLog,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		let doc: DistributionLog;
		if ('_id' in logInput && logInput.type === 'distribution_log') {
			doc = distributionLogDocSchema.parse(logInput);
		} else {
			doc = createDistributionLog(logInput as DistributionLogInput, ctx);
		}
		return putDoc(this.dbName, doc);
	}

	async get(logId: string): Promise<DistributionLog | null> {
		const raw = await getDoc<DistributionLog>(this.dbName, logId);
		if (!raw) return null;
		return distributionLogDocSchema.parse(raw);
	}

	async getMany(
		ids: readonly string[]
	): Promise<{ items: DistributionLog[]; skipped: SkippedDoc[] }> {
		const unique = [...new Set(ids)];
		const raws: unknown[] = [];
		for (let i = 0; i < unique.length; i += GET_MANY_CHUNK_SIZE) {
			raws.push(
				...(await allDocsByIds<DistributionLog>(
					this.dbName,
					unique.slice(i, i + GET_MANY_CHUNK_SIZE),
					(d): d is DistributionLog => typeof d === 'object' && d !== null
				))
			);
		}
		return parseDocsOrSkip<DistributionLog>(raws, distributionLogDocSchema);
	}

	async list(filter?: DistributionLogListFilter): Promise<DistributionLog[]> {
		return (await this.listWithSkipped(filter)).items;
	}

	async listWithSkipped(
		filter?: DistributionLogListFilter
	): Promise<{ items: DistributionLog[]; skipped: SkippedDoc[] }> {
		const docs = await allDocsByType<DistributionLog>(
			this.dbName,
			'distribution_log',
			(d): d is DistributionLog =>
				typeof d === 'object' && d !== null && (d as { type?: string }).type === 'distribution_log'
		);
		const { items, skipped } = parseDocsOrSkip<DistributionLog>(docs, distributionLogDocSchema);
		const rawById = new Map(docs.map((d) => [(d as { _id?: unknown })._id, d]));
		return {
			items: items.filter((log) => {
				if (filter?.ticket_id && log.ticket_id !== filter.ticket_id) return false;
				if (filter?.item_id && log.item_id !== filter.item_id) return false;
				if (filter?.status && log.status !== filter.status) return false;
				if (filter?.is_returnable !== undefined && log.is_returnable !== filter.is_returnable)
					return false;
				if (filter?.recipient_id !== undefined && log.recipient_id !== filter.recipient_id)
					return false;
				return true;
			}),
			skipped: skipped.filter((s) => rawMatchesFilter(rawById.get(s._id), filter))
		};
	}

	async mutateLogCAS(
		logId: string,
		mutator: (current: DistributionLog) => DistributionLog
	): Promise<DistributionLog> {
		return retryCas(async () => {
			const current = await this.get(logId);
			if (!current) {
				throw new NotFoundError(`Distribution log ${logId} not found`);
			}

			const computed = mutator(current);
			// Same reference = "nothing to write" (e.g. an already-applied bulk entry); mirrors the pool repo.
			if (computed === current) return current;
			assertDistributionLogIssuanceImmutable(current, computed);

			const next = distributionLogDocSchema.parse({
				...computed,
				_id: current._id,
				_rev: current._rev,
				shelter_code: current.shelter_code,
				updated_at: now()
			});

			return putDoc(this.dbName, next);
		});
	}

	async recordReturn(
		logId: string,
		input: RecordReturnInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (current) => {
			if (!current.is_returnable) {
				throw new Error(`Cannot return non-returnable distribution log ${logId}`);
			}
			if (['returned', 'lost', 'waived', 'voided'].includes(current.status)) {
				throw new Error(`Distribution log ${logId} is already closed as ${current.status}`);
			}
			if (input.clear_reason !== 'routine' && input.clear_reason !== 'bulk_dropoff') {
				throw new Error(
					`Invalid clear_reason '${input.clear_reason}' for physical return; use recordClear for non-physical resolutions`
				);
			}
			if (input.clear_reason === 'bulk_dropoff' && !input.bulk_pool_id) {
				throw new Error('bulk_dropoff requires bulk_pool_id');
			}

			const returnedQtyDec = parseQty(input.qty_returned);
			const totalQtyDec = parseQty(current.qty);
			if (returnedQtyDec.isNegative() || returnedQtyDec.isZero()) {
				throw new Error('qty_returned must be positive');
			}
			if (!qtyLte(input.qty_returned, current.qty)) {
				throw new Error(
					`qty_returned (${input.qty_returned}) cannot exceed issued qty (${current.qty})`
				);
			}

			const nextStatus: DistributionLogStatus = returnedQtyDec.eq(totalQtyDec)
				? 'returned'
				: 'partially_returned';

			return {
				...current,
				status: nextStatus,
				qty_returned: input.qty_returned,
				condition_on_return: input.condition_on_return,
				clear_reason: input.clear_reason,
				bulk_pool_id: input.bulk_pool_id,
				returned_at: now(),
				returned_by: ctx.createdBy,
				...(input.notes ? { notes: input.notes } : {})
			};
		});
	}

	async recordClear(
		logId: string,
		input: RecordClearInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (current) => {
			if (!current.is_returnable) {
				throw new Error(`Cannot clear non-returnable distribution log ${logId}`);
			}
			if (['returned', 'lost', 'waived', 'voided'].includes(current.status)) {
				throw new Error(`Distribution log ${logId} is already closed as ${current.status}`);
			}
			if (input.clear_reason !== 'lost' && input.clear_reason !== 'waived') {
				throw new Error(
					`Invalid clear_reason '${input.clear_reason}' for recordClear; use recordReturn for physical returns`
				);
			}
			if (!input.notes || !input.notes.trim()) {
				throw new Error(`notes are required when clearing a loan as ${input.clear_reason}`);
			}

			return {
				...current,
				status: input.clear_reason,
				clear_reason: input.clear_reason,
				returned_at: now(),
				returned_by: ctx.createdBy,
				notes: input.notes.trim()
			};
		});
	}

	async recordVoid(logId: string, ctx: AuthorContext, notes?: string): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (current) => {
			if (current.status === 'voided') {
				return current;
			}
			assertDistributionLogCanBeVoided(current);
			return {
				...current,
				status: 'voided',
				voided_at: now(),
				voided_by: ctx.createdBy,
				...(notes ? { notes } : {})
			};
		});
	}
}
