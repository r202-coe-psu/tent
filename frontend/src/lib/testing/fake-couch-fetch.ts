/**
 * A `fetch` stand-in that answers like CouchDB, so a test can run the real `$lib/db/couch-db`
 * (and with it `stampWriter`) end to end instead of mocking that module away. Supports what the
 * repositories use: `PUT /{db}/{id}`, `GET /{db}/{id}`, `GET /{db}/_all_docs` by key range,
 * `POST /{db}/_find` with an equality selector, and `POST /{db}/_bulk_docs`. Docs are stored
 * exactly as sent, `updated_by` included.
 *
 * ```ts
 * const couch = createFakeCouchFetch();
 * vi.stubGlobal('fetch', couch.fetch);
 * ```
 */
export interface FakeCouchDoc {
	_id: string;
	_rev?: string;
	[key: string]: unknown;
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createFakeCouchFetch() {
	const dbs = new Map<string, Map<string, FakeCouchDoc>>();
	const db = (name: string) => {
		if (!dbs.has(name)) dbs.set(name, new Map());
		return dbs.get(name)!;
	};

	function write(dbName: string, doc: FakeCouchDoc): { ok: true; id: string; rev: string } | null {
		const docs = db(dbName);
		const current = docs.get(doc._id);
		if (current && current._rev !== doc._rev) return null;
		const generation = current?._rev ? Number(current._rev.split('-')[0]) + 1 : 1;
		const rev = `${generation}-fake`;
		docs.set(doc._id, { ...structuredClone(doc), _rev: rev });
		return { ok: true, id: doc._id, rev };
	}

	async function fetchImpl(input: string | URL | Request, init: RequestInit = {}) {
		const url = new URL(String(input instanceof Request ? input.url : input), 'http://fake');
		const [dbName, ...rest] = url.pathname
			.split('/')
			.filter(Boolean)
			.filter((part) => part !== 'couch');
		const tail = decodeURIComponent(rest.join('/'));
		const method = (init.method ?? 'GET').toUpperCase();
		const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;

		if (method === 'POST' && tail === '_find') {
			const selector = (body?.selector ?? {}) as Record<string, unknown>;
			const docs = [...db(dbName).values()].filter((doc) =>
				Object.entries(selector).every(
					([key, value]) => typeof value === 'object' || doc[key] === value
				)
			);
			return json(200, { docs, bookmark: 'nil' });
		}
		if (method === 'POST' && tail === '_bulk_docs') {
			return json(
				201,
				(body.docs as FakeCouchDoc[]).map(
					(doc) => write(dbName, doc) ?? { id: doc._id, error: 'conflict', status: 409 }
				)
			);
		}
		if (method === 'PUT') {
			const result = write(dbName, { ...body, _id: tail });
			return result ? json(201, result) : json(409, { error: 'conflict' });
		}
		if (method === 'GET' && tail === '_all_docs') {
			const param = (key: string) => {
				const raw = url.searchParams.get(key);
				return raw === null ? null : (JSON.parse(raw) as string);
			};
			const descending = url.searchParams.get('descending') === 'true';
			const [from, to] = [param('startkey'), param('endkey')];
			const [low, high] = descending ? [to, from] : [from, to];
			const rows = [...db(dbName).values()]
				.filter((doc) => (low === null || doc._id >= low) && (high === null || doc._id <= high))
				.sort((a, b) => (descending ? b._id.localeCompare(a._id) : a._id.localeCompare(b._id)))
				.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc }));
			return json(200, { rows });
		}
		if (method === 'GET') {
			const doc = db(dbName).get(tail);
			return doc ? json(200, doc) : json(404, { error: 'not_found' });
		}
		return json(405, { error: 'method_not_allowed' });
	}

	return {
		fetch: fetchImpl as typeof fetch,
		docs: (dbName: string) => [...db(dbName).values()],
		get: (dbName: string, id: string) => db(dbName).get(id),
		reset: () => dbs.clear()
	};
}
