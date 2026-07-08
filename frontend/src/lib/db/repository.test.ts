// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteRepository, type Repository } from './repository';
import { makeDoc, type AuthorContext, type BaseDoc } from './model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

interface Note extends BaseDoc {
	type: 'note';
	body: string;
}
const isNote = (d: unknown): d is Note =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'note';

function newNote(body: string): Note {
	return makeDoc('note', 1, { body }, ctx);
}

const store = new Map<string, Map<string, unknown>>();

function couchApiPath(url: string): string {
	return url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/couch/, '');
}

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === 'string' ? input : input.toString();
	const method = init?.method ?? 'GET';
	const path = couchApiPath(url);

	const dbMatch = path.match(/^\/([^/]+)\/(_all_docs|_bulk_docs|[^/?]+)/);
	const dbName = dbMatch?.[1] ?? 'test';
	if (!store.has(dbName)) store.set(dbName, new Map());
	const db = store.get(dbName)!;

	if (url.includes('/_all_docs')) {
		const qs = url.includes('?') ? url.split('?')[1] : '';
		const params = new URLSearchParams(qs);
		const startkeyRaw = params.get('startkey');
		const endkeyRaw = params.get('endkey');
		const startkey = startkeyRaw ? JSON.parse(startkeyRaw) : '';
		const endkey = endkeyRaw ? JSON.parse(endkeyRaw) : '\uffff';
		const docs = [...db.values()].filter((doc) => {
			const id = (doc as { _id: string })._id;
			return id >= startkey && id <= endkey;
		});
		return Promise.resolve(
			new Response(
				JSON.stringify({
					rows: docs.map((doc) => ({
						id: (doc as { _id: string })._id,
						doc
					}))
				}),
				{ status: 200 }
			)
		);
	}

	if (url.includes('/_bulk_docs') && method === 'POST') {
		const body = JSON.parse(init?.body as string) as { docs: Array<{ _id: string }> };
		const results = body.docs.map((doc) => {
			const existing = db.get(doc._id);
			if (existing && (doc as { _rev?: string })._rev !== (existing as { _rev?: string })._rev) {
				return { error: 'conflict', status: 409, id: doc._id };
			}
			const rev = existing
				? `${parseInt(((existing as { _rev: string })._rev ?? '0-0').split('-')[0]) + 1}-xxx`
				: '1-xxx';
			const saved = { ...doc, _rev: rev };
			db.set(doc._id, saved);
			return { ok: true, id: doc._id, rev };
		});
		return Promise.resolve(new Response(JSON.stringify(results), { status: 201 }));
	}

	const pathBase = path.split('?')[0];
	const segments = pathBase.split('/').filter(Boolean);
	const id = segments.length >= 2 ? decodeURIComponent(segments[segments.length - 1]) : '';

	if (method === 'PUT' && id && !id.startsWith('_')) {
		const body = JSON.parse(init?.body as string) as { _id: string; _rev?: string };
		const existing = db.get(body._id);
		if (existing && body._rev !== (existing as { _rev?: string })._rev) {
			return Promise.resolve(
				new Response(JSON.stringify({ error: 'conflict', reason: 'Document update conflict' }), {
					status: 409
				})
			);
		}
		const rev = existing
			? `${parseInt(((existing as { _rev: string })._rev ?? '0-0').split('-')[0]) + 1}-xxx`
			: '1-xxx';
		const saved = { ...body, _rev: rev };
		db.set(body._id, saved);
		return Promise.resolve(
			new Response(JSON.stringify({ ok: true, id: body._id, rev }), {
				status: existing ? 200 : 201
			})
		);
	}

	if (method === 'GET' && id && !id.startsWith('_')) {
		const doc = db.get(id);
		if (!doc) {
			return Promise.resolve(
				new Response(JSON.stringify({ error: 'not_found', reason: 'missing' }), { status: 404 })
			);
		}
		return Promise.resolve(new Response(JSON.stringify(doc), { status: 200 }));
	}

	if (method === 'DELETE') {
		db.delete(id);
		return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
	}

	return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

describe('createRemoteRepository', () => {
	let repo: Repository;
	const dbName = `test-${Math.random().toString(36).slice(2)}`;

	beforeEach(() => {
		store.set(dbName, new Map());
		vi.stubGlobal('fetch', mockFetch);
		repo = createRemoteRepository(dbName);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		store.delete(dbName);
	});

	it('put returns the doc stamped with a fresh _rev', async () => {
		const saved = await repo.put(newNote('hello'));
		expect(saved._rev).toMatch(/^1-/);
		expect(saved.body).toBe('hello');
	});

	it('get round-trips a stored doc and returns null for a missing id', async () => {
		const saved = await repo.put(newNote('hi'));
		const fetched = await repo.get<Note>(saved._id);
		expect(fetched?.body).toBe('hi');
		expect(await repo.get('note:does-not-exist')).toBeNull();
	});

	it('allByType returns only docs of the prefix, narrowed by the guard', async () => {
		await repo.put(newNote('a'));
		await repo.put(newNote('b'));
		await repo.put(makeDoc('evacuee', 1, { first_name: 'X' }, ctx));

		const notes = await repo.allByType('note', isNote);
		expect(notes).toHaveLength(2);
		expect(notes.every(isNote)).toBe(true);
	});

	it('put with a live _rev updates instead of conflicting', async () => {
		const saved = await repo.put(newNote('v1'));
		const updated = await repo.put({ ...saved, body: 'v2' });
		expect(updated._rev).toMatch(/^2-/);
		expect((await repo.get<Note>(saved._id))?.body).toBe('v2');
	});

	it('remove deletes a doc', async () => {
		const saved = await repo.put(newNote('bye'));
		await repo.remove(saved);
		expect(await repo.get(saved._id)).toBeNull();
	});
});
