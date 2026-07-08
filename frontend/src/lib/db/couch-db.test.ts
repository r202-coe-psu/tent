// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc, putDoc, bulkDocs } from './couch-db';
import { CouchAuthError } from '$lib/utils/errors';

const store = new Map<string, unknown>();

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === 'string' ? input : input.toString();
	const method = init?.method ?? 'GET';
	const idMatch = url.match(/\/testdb\/([^/?]+)/);
	const id = idMatch ? decodeURIComponent(idMatch[1]) : '';

	if (method === 'PUT' && id) {
		const body = JSON.parse(init?.body as string) as { _id: string; _rev?: string };
		const existing = store.get(body._id);
		if (existing && body._rev !== (existing as { _rev?: string })._rev) {
			return Promise.resolve(new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }));
		}
		const rev = existing ? '2-abc' : '1-abc';
		const saved = { ...body, _rev: rev };
		store.set(body._id, saved);
		return Promise.resolve(
			new Response(JSON.stringify({ ok: true, id: body._id, rev }), { status: 201 })
		);
	}

	if (method === 'GET' && id) {
		const doc = store.get(id);
		if (!doc) {
			return Promise.resolve(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
		}
		return Promise.resolve(new Response(JSON.stringify(doc), { status: 200 }));
	}

	if (url.includes('/_bulk_docs')) {
		const body = JSON.parse(init?.body as string) as {
			docs: Array<{ _id: string; _rev?: string }>;
		};
		const results = body.docs.map((doc) => {
			store.set(doc._id, { ...doc, _rev: '1-bulk' });
			return { ok: true, id: doc._id, rev: '1-bulk' };
		});
		return Promise.resolve(new Response(JSON.stringify(results), { status: 201 }));
	}

	return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
}

beforeEach(() => {
	store.clear();
	vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('couch-db', () => {
	it('putDoc creates a document with _rev', async () => {
		const saved = await putDoc('testdb', { _id: 'note:1', body: 'hi' });
		expect((saved as { _rev?: string })._rev).toBe('1-abc');
	});

	it('getDoc returns null for missing documents', async () => {
		expect(await getDoc('testdb', 'note:missing')).toBeNull();
	});

	it('putDoc treats 409 on create as idempotent success', async () => {
		await putDoc('testdb', { _id: 'note:dup', body: 'first' });
		const again = await putDoc('testdb', { _id: 'note:dup', body: 'retry' });
		expect((again as { _rev?: string })._rev).toBe('1-abc');
	});

	it('bulkDocs writes multiple documents', async () => {
		const results = await bulkDocs('testdb', [{ _id: 'a:1' }, { _id: 'a:2' }]);
		expect(results).toHaveLength(2);
		expect((results[0] as { _rev?: string })._rev).toBe('1-bulk');
	});

	it('maps 401 to CouchAuthError', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
		);
		await expect(putDoc('testdb', { _id: 'x:1' })).rejects.toBeInstanceOf(CouchAuthError);
	});
});
