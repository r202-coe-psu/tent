/**
 * In-memory multi-database CouchDB for the shelter close job tests (CR-243 "Test seam").
 *
 * Separate from the single-db `FakeCouch` of `shelter-close.test.ts` on purpose: it serves any db
 * by name (`central_ops`, `shelter_<code>`), keeps a real per-doc `_rev` and answers `409` on a
 * stale write, and evaluates the `jobs_claimable` view of `_design/shelter_close`
 * (`startkey` / `endkey` / `include_docs` / `limit`) with CouchDB collation.
 */
import type { CouchReq } from '../ensure-public-writer';

export type FakeDoc = Record<string, unknown> & { _id: string; _rev: string };
type Res = { status: number; data: unknown };

/** Return a response to short-circuit the request (fault injection), `undefined` to pass through. */
export type FakeCouchHook = (call: {
	method: string;
	db: string;
	path: string;
	body: unknown;
}) => Res | undefined;

/** CouchDB collation, enough for string / array / object keys (`{}` sorts after strings). */
function rank(v: unknown): number {
	if (v === null) return 0;
	if (typeof v === 'boolean') return 1;
	if (typeof v === 'number') return 2;
	if (typeof v === 'string') return 3;
	if (Array.isArray(v)) return 4;
	return 5;
}
export function collate(a: unknown, b: unknown): number {
	const ra = rank(a);
	const rb = rank(b);
	if (ra !== rb) return ra < rb ? -1 : 1;
	if (Array.isArray(a) && Array.isArray(b)) {
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			const c = collate(a[i], b[i]);
			if (c !== 0) return c;
		}
		return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
	}
	if (ra === 5) return 0;
	if (a === b) return 0;
	return (a as string) < (b as string) ? -1 : 1;
}

export class FakeCouchServer {
	dbs = new Map<string, Map<string, FakeDoc>>();
	log: { method: string; db: string; path: string }[] = [];
	/** Fault injection, runs before the built-in handling. */
	hook: FakeCouchHook | null = null;
	/** Per-doc `_bulk_docs` fault: return an error row to reject that doc instead of writing it. */
	bulkFault:
		((doc: { _id: string; type?: string }) => { error: string; reason?: string } | null) | null =
		null;
	/** Every `_bulk_docs` request, as `[db, doc types]`, in order. */
	bulkLog: { db: string; types: string[] }[] = [];
	/** `_all_docs` scans per db, to assert a caller did not scan `central_ops`. */
	allDocsScans = new Map<string, number>();
	viewReads = 0;
	private seq = 0;

	private nextRev(prev?: string) {
		this.seq += 1;
		const gen = prev ? Number(prev.split('-')[0]) + 1 : 1;
		return `${gen}-${this.seq.toString(16)}`;
	}

	createDb(name: string) {
		if (!this.dbs.has(name)) this.dbs.set(name, new Map());
		return this.dbs.get(name)!;
	}

	/** Direct write (test setup), bypassing `_rev` checks. */
	put(db: string, doc: Record<string, unknown> & { _id: string }): FakeDoc {
		const store = this.createDb(db);
		const saved = {
			...structuredClone(doc),
			_rev: this.nextRev(store.get(doc._id)?._rev)
		} as FakeDoc;
		store.set(doc._id, saved);
		return saved;
	}

	get(db: string, id: string): FakeDoc | undefined {
		const d = this.dbs.get(db)?.get(id);
		return d ? structuredClone(d) : undefined;
	}

	/** Direct delete (simulates another actor removing a doc). */
	remove(db: string, id: string) {
		this.dbs.get(db)?.delete(id);
	}

	docs(db: string): FakeDoc[] {
		return [...(this.dbs.get(db)?.values() ?? [])].map((d) => structuredClone(d));
	}

	byType(db: string, type: string) {
		return this.docs(db).filter((d) => d.type === type);
	}

	private view(store: Map<string, FakeDoc>, url: URL): Res {
		this.viewReads += 1;
		const startkey = url.searchParams.has('startkey')
			? JSON.parse(url.searchParams.get('startkey')!)
			: undefined;
		const endkey = url.searchParams.has('endkey')
			? JSON.parse(url.searchParams.get('endkey')!)
			: undefined;
		const limit = Number(url.searchParams.get('limit') ?? Number.MAX_SAFE_INTEGER);
		const includeDocs = url.searchParams.get('include_docs') === 'true';
		// map of jobs_claimable: emit([status, lease_until || created_at]) for queued / running jobs
		const rows = [...store.values()]
			.filter(
				(d) => d.type === 'shelter_close_job' && (d.status === 'queued' || d.status === 'running')
			)
			.map((d) => ({
				id: d._id,
				key: [d.status, (d.lease_until as string | undefined) || (d.created_at as string)],
				value: null as null,
				doc: d
			}))
			.filter(
				(r) =>
					(startkey === undefined || collate(r.key, startkey) >= 0) &&
					(endkey === undefined || collate(r.key, endkey) <= 0)
			)
			.sort((a, b) => collate(a.key, b.key) || collate(a.id, b.id))
			.slice(0, limit)
			.map((r) => ({
				id: r.id,
				key: r.key,
				value: r.value,
				...(includeDocs ? { doc: structuredClone(r.doc) } : {})
			}));
		return { status: 200, data: { total_rows: rows.length, offset: 0, rows } };
	}

	req: CouchReq = async (method, path, body) => {
		const url = new URL(`http://couch${path}`);
		const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
		const db = parts[0] ?? '';
		this.log.push({ method, db, path });
		const injected = this.hook?.({ method, db, path, body });
		if (injected) return injected;

		if (parts.length === 1) {
			if (method === 'PUT') {
				if (this.dbs.has(db)) return { status: 412, data: { error: 'file_exists' } };
				this.createDb(db);
				return { status: 201, data: { ok: true } };
			}
			return this.dbs.has(db)
				? { status: 200, data: { db_name: db } }
				: { status: 404, data: { error: 'not_found' } };
		}
		const store = this.dbs.get(db);
		if (!store)
			return { status: 404, data: { error: 'not_found', reason: 'Database does not exist.' } };

		// _design/<name>/_view/<view>
		if (parts[1] === '_design' && parts[3] === '_view') {
			const ddoc = store.get(`_design/${parts[2]}`);
			if (!ddoc) return { status: 404, data: { error: 'not_found' } };
			const views = ddoc.views as Record<string, unknown> | undefined;
			if (!views?.[parts[4]]) return { status: 404, data: { error: 'not_found' } };
			if (parts[2] === 'shelter_close' && parts[4] === 'jobs_claimable') {
				return this.view(store, url);
			}
			return { status: 404, data: { error: 'not_found' } };
		}

		if (parts[1] === '_all_docs') {
			this.allDocsScans.set(db, (this.allDocsScans.get(db) ?? 0) + 1);
			if (method === 'POST') {
				const keys = (body as { keys: string[] }).keys;
				return {
					status: 200,
					data: {
						rows: keys.map((id) => ({
							id,
							doc: store.has(id) ? structuredClone(store.get(id)) : null
						}))
					}
				};
			}
			const start = JSON.parse(url.searchParams.get('startkey') ?? '""') as string;
			const end = JSON.parse(url.searchParams.get('endkey') ?? '"\\uffff"') as string;
			const limit = Number(url.searchParams.get('limit') ?? 1e9);
			const skip = Number(url.searchParams.get('skip') ?? 0);
			const rows = [...store.keys()]
				.sort()
				.filter((id) => id >= start && id <= end)
				.slice(skip, skip + limit)
				.map((id) => ({ id, doc: structuredClone(store.get(id)) }));
			return { status: 200, data: { rows } };
		}

		if (parts[1] === '_bulk_docs' && method === 'POST') {
			const docs = (body as { docs: (Record<string, unknown> & { _id: string; _rev?: string })[] })
				.docs;
			this.bulkLog.push({ db, types: docs.map((d) => String(d.type)) });
			const rows = docs.map((doc) => {
				const fault = this.bulkFault?.(doc);
				if (fault) return { id: doc._id, ...fault };
				const cur = store.get(doc._id);
				if ((cur?._rev ?? undefined) !== (doc._rev ?? undefined)) {
					return { id: doc._id, error: 'conflict', reason: 'Document update conflict.' };
				}
				const saved = this.put(db, doc);
				return { id: doc._id, ok: true, rev: saved._rev };
			});
			return { status: 201, data: rows };
		}

		// single doc (id may contain `/` only for _design docs)
		const id = parts[1] === '_design' ? `_design/${parts[2]}` : parts[1];
		const cur = store.get(id);
		if (method === 'GET') {
			return cur
				? { status: 200, data: structuredClone(cur) }
				: { status: 404, data: { error: 'not_found', reason: 'missing' } };
		}
		if (method === 'PUT') {
			const doc = body as Record<string, unknown> & { _id?: string; _rev?: string };
			if ((cur?._rev ?? undefined) !== (doc._rev ?? undefined)) {
				return { status: 409, data: { error: 'conflict', reason: 'Document update conflict.' } };
			}
			const saved = this.put(db, { ...doc, _id: id });
			return { status: 201, data: { ok: true, id, rev: saved._rev } };
		}
		if (method === 'DELETE') {
			if (!cur) return { status: 404, data: { error: 'not_found' } };
			if (url.searchParams.get('rev') !== cur._rev) {
				return { status: 409, data: { error: 'conflict', reason: 'Document update conflict.' } };
			}
			store.delete(id);
			return { status: 200, data: { ok: true, id, rev: this.nextRev(cur._rev) } };
		}
		return { status: 400, data: { error: 'unsupported' } };
	};
}
