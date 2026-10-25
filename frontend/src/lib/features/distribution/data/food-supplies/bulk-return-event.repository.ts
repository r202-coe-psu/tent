import { allDocsByIds, allDocsByType, findDocsPage, getDoc, putDocStrict } from '$lib/db/couch-db';
import {
	bulkReturnEntryDocSchema,
	bulkReturnEntryMoveDocSchema,
	bulkReturnEntryVoidDocSchema,
	type BulkReturnEntry,
	type BulkReturnEntryMove,
	type BulkReturnEntryVoid,
	type BulkReturnEventSet
} from '../../domain/food-supplies';
import { parseDocsOrSkip, type SkippedDoc } from './parse-or-skip';
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
	/**
	 * One entry with its whole move chain and void (an unknown entry yields empty lists). Reads only
	 * that entry's docs, so an invalid doc elsewhere in the shelter cannot affect it.
	 */
	listForEntry(entryId: string): Promise<ScopedBulkReturnEventSet>;
	/**
	 * Every entry currently relevant to `poolId`: entries created in it (`(type, pool_id)` index) and
	 * entries moved into it (`(type, to_pool_id)` index), each with its WHOLE move chain and void, so
	 * the domain fold still resolves the current pool (an entry moved on elsewhere resolves away).
	 * Moves/voids of unrelated entries are not read.
	 */
	listForPool(poolId: string): Promise<ScopedBulkReturnEventSet>;
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
		return parseScopedSet(entries, moves, voids);
	}

	async listForEntry(entryId: string): Promise<ScopedBulkReturnEventSet> {
		if (!entryId.startsWith(ENTRY_ID_PREFIX)) return emptyScopedSet();
		const ulid = entryId.slice(ENTRY_ID_PREFIX.length);
		const [entry, moves, entryVoid] = await Promise.all([
			getDoc<{ _id: string }>(this.dbName, entryId),
			this.listMovesOfEntry(ulid),
			getDoc<{ _id: string }>(this.dbName, `${VOID_ID_PREFIX}${ulid}`)
		]);
		return parseScopedSet(entry ? [entry] : [], moves, entryVoid ? [entryVoid] : []);
	}

	async listForPool(poolId: string): Promise<ScopedBulkReturnEventSet> {
		const [createdRaw, movedInRaw] = await Promise.all([
			findAllByField(this.dbName, 'bulk_return_entry', 'pool_id', poolId),
			findAllByField(this.dbName, 'bulk_return_entry_move', 'to_pool_id', poolId)
		]);
		const created = parseDocsOrSkip<BulkReturnEntry>(createdRaw, bulkReturnEntryDocSchema);
		const movedIn = parseDocsOrSkip<BulkReturnEntryMove>(movedInRaw, bulkReturnEntryMoveDocSchema);

		const entryRaws: unknown[] = [...createdRaw];
		const known = new Set(created.items.map((e) => e._id));
		const ids = new Set(known);
		for (const move of movedIn.items) ids.add(move.entry_id);

		const missing = [...ids].filter((id) => !known.has(id));
		for (const chunk of chunked(missing, ID_CHUNK_SIZE)) {
			entryRaws.push(
				...(await allDocsByIds<BulkReturnEntry>(
					this.dbName,
					chunk,
					isOfType<BulkReturnEntry>('bulk_return_entry')
				))
			);
		}

		const ulids = [...ids].map((id) => id.slice(ENTRY_ID_PREFIX.length));
		const moveRaws: unknown[] = [];
		for (const chunk of chunked(ulids, MOVE_SCAN_CONCURRENCY)) {
			for (const moves of await Promise.all(chunk.map((ulid) => this.listMovesOfEntry(ulid)))) {
				moveRaws.push(...moves);
			}
		}
		const voidRaws: unknown[] = [];
		for (const chunk of chunked(ulids, ID_CHUNK_SIZE)) {
			voidRaws.push(
				...(await allDocsByIds<BulkReturnEntryVoid>(
					this.dbName,
					chunk.map((ulid) => `${VOID_ID_PREFIX}${ulid}`),
					isOfType<BulkReturnEntryVoid>('bulk_return_entry_void')
				))
			);
		}

		const set = parseScopedSet(entryRaws, moveRaws, voidRaws);
		return {
			...set,
			skipped: dedupeSkipped([...movedIn.skipped, ...set.skipped])
		};
	}

	/** `_all_docs` scan of the `bulk_return_entry_move:{entryULID}:` id prefix (one entry's chain). */
	private listMovesOfEntry(entryUlid: string): Promise<BulkReturnEntryMove[]> {
		return allDocsByType<BulkReturnEntryMove>(
			this.dbName,
			`${MOVE_ID_PREFIX}${entryUlid}`,
			isOfType<BulkReturnEntryMove>('bulk_return_entry_move')
		);
	}
}

/** A `listAll`-shaped event set plus the docs the read left out because they failed validation. */
export type ScopedBulkReturnEventSet = BulkReturnEventSet & { skipped: SkippedDoc[] };

const ENTRY_ID_PREFIX = 'bulk_return_entry:';
const MOVE_ID_PREFIX = 'bulk_return_entry_move:';
const VOID_ID_PREFIX = 'bulk_return_entry_void:';
/** Explicit `_find` page size: CouchDB defaults to 25 rows, which would silently truncate. */
const FIND_PAGE_SIZE = 200;
/** Ids per `_all_docs` keys request. */
const ID_CHUNK_SIZE = 100;
/** Parallel per-entry move-prefix scans. */
const MOVE_SCAN_CONCURRENCY = 20;

function emptyScopedSet(): ScopedBulkReturnEventSet {
	return { entries: [], moves: [], voids: [], skipped: [] };
}

function chunked<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

function dedupeSkipped(skipped: readonly SkippedDoc[]): SkippedDoc[] {
	const seen = new Set<string>();
	return skipped.filter((s) => {
		if (!s._id) return true;
		if (seen.has(s._id)) return false;
		seen.add(s._id);
		return true;
	});
}

function parseScopedSet(
	entries: readonly unknown[],
	moves: readonly unknown[],
	voids: readonly unknown[]
): ScopedBulkReturnEventSet {
	const e = parseDocsOrSkip<BulkReturnEntry>(entries, bulkReturnEntryDocSchema);
	const m = parseDocsOrSkip<BulkReturnEntryMove>(moves, bulkReturnEntryMoveDocSchema);
	const v = parseDocsOrSkip<BulkReturnEntryVoid>(voids, bulkReturnEntryVoidDocSchema);
	return {
		entries: e.items,
		moves: m.items,
		voids: v.items,
		skipped: [...e.skipped, ...m.skipped, ...v.skipped]
	};
}

/**
 * All docs of `type` whose indexed `field` equals `value`, paginated by bookmark (a Mango index on
 * `[type, field]` serves it; without the index CouchDB falls back to a scan and still answers).
 */
async function findAllByField(
	dbName: string,
	type: string,
	field: string,
	value: string
): Promise<unknown[]> {
	const out: unknown[] = [];
	let bookmark: string | undefined;
	for (;;) {
		const page = await findDocsPage<unknown>(dbName, {
			selector: { type, [field]: value },
			limit: FIND_PAGE_SIZE,
			...(bookmark ? { bookmark } : {})
		});
		out.push(...page.docs);
		if (page.docs.length < FIND_PAGE_SIZE || !page.bookmark || page.bookmark === bookmark) break;
		bookmark = page.bookmark;
	}
	return out;
}
