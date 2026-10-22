import { allDocsByType, getDoc, putDocStrict } from '$lib/db/couch-db';
import {
	bulkReturnEntryDocSchema,
	bulkReturnEntryMoveDocSchema,
	bulkReturnEntryVoidDocSchema,
	type BulkReturnEntry,
	type BulkReturnEntryMove,
	type BulkReturnEntryVoid,
	type BulkReturnEventSet
} from '../../domain/food-supplies';
import { resolveShelterDbName } from './shared';

/**
 * #658/#659 — append-only bulk return events: `bulk_return_entry`, `bulk_return_entry_move` and
 * `bulk_return_entry_void`. Creates are put-if-absent (ConflictError when the deterministic id is
 * already taken, so a retry can fetch the winner and verify it is the same event). `listAll` returns
 * the full event log; the domain fold over it is the source of truth for what is in a pool (a
 * moved-in entry is only visible through its move doc, so a `(type, pool_id)` index is not enough).
 * Listing uses `_all_docs` by id prefix, acceptable for shelter-local volumes.
 */
export interface BulkReturnEventRepository {
	createEntry(entry: BulkReturnEntry): Promise<BulkReturnEntry>;
	getEntry(entryId: string): Promise<BulkReturnEntry | null>;
	createMove(move: BulkReturnEntryMove): Promise<BulkReturnEntryMove>;
	getMove(moveId: string): Promise<BulkReturnEntryMove | null>;
	createVoid(entryVoid: BulkReturnEntryVoid): Promise<BulkReturnEntryVoid>;
	getVoid(voidId: string): Promise<BulkReturnEntryVoid | null>;
	listAll(): Promise<BulkReturnEventSet>;
}

const isOfType =
	<T>(type: string) =>
	(d: unknown): d is T =>
		typeof d === 'object' && d !== null && (d as { type?: string }).type === type;

export class BulkReturnEventRemoteRepository implements BulkReturnEventRepository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async createEntry(entry: BulkReturnEntry): Promise<BulkReturnEntry> {
		const doc = bulkReturnEntryDocSchema.parse(entry) as BulkReturnEntry;
		return putDocStrict(this.dbName, doc);
	}

	async getEntry(entryId: string): Promise<BulkReturnEntry | null> {
		const raw = await getDoc<BulkReturnEntry>(this.dbName, entryId);
		return raw ? (bulkReturnEntryDocSchema.parse(raw) as BulkReturnEntry) : null;
	}

	async createMove(move: BulkReturnEntryMove): Promise<BulkReturnEntryMove> {
		const doc = bulkReturnEntryMoveDocSchema.parse(move) as BulkReturnEntryMove;
		return putDocStrict(this.dbName, doc);
	}

	async getMove(moveId: string): Promise<BulkReturnEntryMove | null> {
		const raw = await getDoc<BulkReturnEntryMove>(this.dbName, moveId);
		return raw ? (bulkReturnEntryMoveDocSchema.parse(raw) as BulkReturnEntryMove) : null;
	}

	async createVoid(entryVoid: BulkReturnEntryVoid): Promise<BulkReturnEntryVoid> {
		const doc = bulkReturnEntryVoidDocSchema.parse(entryVoid) as BulkReturnEntryVoid;
		return putDocStrict(this.dbName, doc);
	}

	async getVoid(voidId: string): Promise<BulkReturnEntryVoid | null> {
		const raw = await getDoc<BulkReturnEntryVoid>(this.dbName, voidId);
		return raw ? (bulkReturnEntryVoidDocSchema.parse(raw) as BulkReturnEntryVoid) : null;
	}

	async listAll(): Promise<BulkReturnEventSet> {
		const [entries, moves, voids] = await Promise.all([
			allDocsByType<BulkReturnEntry>(
				this.dbName,
				'bulk_return_entry',
				isOfType<BulkReturnEntry>('bulk_return_entry')
			),
			allDocsByType<BulkReturnEntryMove>(
				this.dbName,
				'bulk_return_entry_move',
				isOfType<BulkReturnEntryMove>('bulk_return_entry_move')
			),
			allDocsByType<BulkReturnEntryVoid>(
				this.dbName,
				'bulk_return_entry_void',
				isOfType<BulkReturnEntryVoid>('bulk_return_entry_void')
			)
		]);
		return {
			entries: entries.map((d) => bulkReturnEntryDocSchema.parse(d) as BulkReturnEntry),
			moves: moves.map((d) => bulkReturnEntryMoveDocSchema.parse(d) as BulkReturnEntryMove),
			voids: voids.map((d) => bulkReturnEntryVoidDocSchema.parse(d) as BulkReturnEntryVoid)
		};
	}
}
