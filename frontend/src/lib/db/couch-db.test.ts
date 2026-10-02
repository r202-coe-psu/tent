// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getDoc,
	getDocWithConflicts,
	putDoc,
	putDocStrict,
	bulkDocs,
	takePageWithCursor,
	allDocsByTypePage,
	countDocsByType
} from './couch-db';
import { CouchAuthError, CouchDocumentPolicyError, ConflictError } from '$lib/utils/errors';

const markNeedsReauth = vi.fn();

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		markNeedsReauth: (...args: unknown[]) => markNeedsReauth(...args)
	}
}));

vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: {
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

const store = new Map<string, unknown>();

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const urlStr = typeof input === 'string' ? input : input.toString();
	const url = new URL(urlStr);
	const method = init?.method ?? 'GET';
	const idMatch = url.pathname.match(/\/testdb\/([^/?]+)/);
	const id = idMatch ? decodeURIComponent(idMatch[1]) : '';

	if (url.pathname.includes('/_all_docs')) {
		const startkeyRaw = url.searchParams.get('startkey');
		const endkeyRaw = url.searchParams.get('endkey');
		const startkey = startkeyRaw ? JSON.parse(startkeyRaw) : '';
		const endkey = endkeyRaw ? JSON.parse(endkeyRaw) : '\uffff';
		const limitRaw = url.searchParams.get('limit');
		const skipRaw = url.searchParams.get('skip');
		const includeDocs = url.searchParams.get('include_docs') !== 'false';
		const limit = limitRaw != null ? Number(limitRaw) : undefined;
		const skip = skipRaw != null ? Number(skipRaw) : 0;

		let docs = [...store.values()]
			.filter((doc) => {
				const docId = (doc as { _id: string })._id;
				return docId >= startkey && docId <= endkey;
			})
			.sort((a, b) => (a as { _id: string })._id.localeCompare((b as { _id: string })._id));

		if (skip > 0) docs = docs.slice(skip);
		if (limit != null && Number.isFinite(limit)) docs = docs.slice(0, limit);

		return Promise.resolve(
			new Response(
				JSON.stringify({
					rows: docs.map((doc) => ({
						id: (doc as { _id: string })._id,
						value: { rev: (doc as { _rev?: string })._rev ?? '1-x' },
						...(includeDocs ? { doc } : {})
					}))
				}),
				{ status: 200 }
			)
		);
	}

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
		const resData = { ...(doc as object) };
		if (url.searchParams.get('conflicts') !== 'true') {
			delete (resData as { _conflicts?: unknown })._conflicts;
		}
		return Promise.resolve(new Response(JSON.stringify(resData), { status: 200 }));
	}

	if (urlStr.includes('/_bulk_docs')) {
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
	markNeedsReauth.mockReset();
	vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('takePageWithCursor', () => {
	const rows = [
		{ _id: 'evacuee:a' },
		{ _id: 'evacuee:b' },
		{ _id: 'evacuee:c' },
		{ _id: 'evacuee:d' }
	];

	it('returns a full page and nextCursor when more rows exist', () => {
		expect(takePageWithCursor(rows, 2, (r) => r._id)).toEqual({
			items: [{ _id: 'evacuee:a' }, { _id: 'evacuee:b' }],
			nextCursor: 'evacuee:b'
		});
	});

	it('returns null nextCursor on the last page', () => {
		expect(takePageWithCursor(rows.slice(0, 2), 2, (r) => r._id)).toEqual({
			items: [{ _id: 'evacuee:a' }, { _id: 'evacuee:b' }],
			nextCursor: null
		});
	});

	it('handles limit < 1 as an empty page', () => {
		expect(takePageWithCursor(rows, 0, (r) => r._id)).toEqual({
			items: [],
			nextCursor: null
		});
	});
});

describe('allDocsByTypePage / countDocsByType', () => {
	const isEvacuee = (d: unknown): d is { _id: string; type: string; name: string } =>
		!!d &&
		typeof d === 'object' &&
		(d as { type?: unknown }).type === 'evacuee' &&
		typeof (d as { _id?: unknown })._id === 'string';

	beforeEach(() => {
		for (const id of ['evacuee:01', 'evacuee:02', 'evacuee:03', 'evacuee:04', 'note:x']) {
			store.set(id, {
				_id: id,
				_rev: '1-a',
				type: id.startsWith('evacuee:') ? 'evacuee' : 'note',
				name: id
			});
		}
	});

	it('pages with limit and resumes via afterId cursor', async () => {
		const page1 = await allDocsByTypePage('testdb', 'evacuee', isEvacuee, { limit: 2 });
		expect(page1.items.map((d) => d._id)).toEqual(['evacuee:01', 'evacuee:02']);
		expect(page1.nextCursor).toBe('evacuee:02');

		const page2 = await allDocsByTypePage('testdb', 'evacuee', isEvacuee, {
			limit: 2,
			afterId: page1.nextCursor!
		});
		expect(page2.items.map((d) => d._id)).toEqual(['evacuee:03', 'evacuee:04']);
		expect(page2.nextCursor).toBeNull();
	});

	it('countDocsByType counts the prefix without include_docs bodies', async () => {
		const fetchSpy = vi.fn(mockFetch);
		vi.stubGlobal('fetch', fetchSpy);

		expect(await countDocsByType('testdb', 'evacuee')).toBe(4);

		const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
		expect(calledUrl.searchParams.get('include_docs')).toBe('false');
	});

	it('requests startkey_docid when resuming from afterId', async () => {
		const fetchSpy = vi.fn(mockFetch);
		vi.stubGlobal('fetch', fetchSpy);

		await allDocsByTypePage('testdb', 'evacuee', isEvacuee, {
			limit: 2,
			afterId: 'evacuee:02'
		});

		const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
		expect(calledUrl.searchParams.get('startkey_docid')).toBe('evacuee:02');
		expect(calledUrl.searchParams.get('skip')).toBe('1');
		expect(calledUrl.searchParams.get('limit')).toBe('3');
	});
});

describe('couch-db', () => {
	it('putDoc creates a document with _rev', async () => {
		const saved = await putDoc('testdb', { _id: 'note:1', body: 'hi' });
		expect((saved as { _rev?: string })._rev).toBe('1-abc');
	});

	it('getDoc returns null for missing documents', async () => {
		expect(await getDoc('testdb', 'note:missing')).toBeNull();
	});

	it('putDoc treats 409 on create as idempotent success by default', async () => {
		await putDoc('testdb', { _id: 'note:dup', body: 'first' });
		const again = await putDoc('testdb', { _id: 'note:dup', body: 'retry' });
		expect((again as { _rev?: string })._rev).toBe('1-abc');
	});

	it('putDoc with onConflict: throw (putDocStrict) throws ConflictError on create 409', async () => {
		await putDoc('testdb', { _id: 'note:strict', body: 'first' });
		await expect(
			putDocStrict('testdb', { _id: 'note:strict', body: 'second' })
		).rejects.toBeInstanceOf(ConflictError);
	});

	it('bulkDocs writes multiple documents', async () => {
		const results = await bulkDocs('testdb', [{ _id: 'a:1' }, { _id: 'a:2' }]);
		expect(results).toHaveLength(2);
		expect((results[0] as { _rev?: string })._rev).toBe('1-bulk');
	});

	it('maps 401 to CouchAuthError and marks needs reauth', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
		);
		await expect(putDoc('testdb', { _id: 'x:1' })).rejects.toBeInstanceOf(CouchAuthError);
		expect(markNeedsReauth).toHaveBeenCalledTimes(1);
	});

	it('maps validate_doc_update 403 to CouchDocumentPolicyError without reauth', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: 'forbidden',
						reason: 'doc type not allowed yet: screening'
					}),
					{ status: 403 }
				)
			)
		);
		const err = await putDoc('testdb', { _id: 'screening:1', type: 'screening' }).catch((e) => e);
		expect(err).toBeInstanceOf(CouchDocumentPolicyError);
		expect((err as CouchDocumentPolicyError).reason).toBe('doc type not allowed yet: screening');
		expect((err as CouchDocumentPolicyError).docId).toBe('screening:1');
		expect((err as CouchDocumentPolicyError).docType).toBe('screening');
		expect(markNeedsReauth).not.toHaveBeenCalled();
	});

	it('maps membership 403 to CouchAuthError and marks needs reauth', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: 'forbidden',
						reason: 'You are not allowed to access this db.'
					}),
					{ status: 403 }
				)
			)
		);
		await expect(putDoc('testdb', { _id: 'x:1' })).rejects.toBeInstanceOf(CouchAuthError);
		expect(markNeedsReauth).toHaveBeenCalledTimes(1);
	});

	it('getDocWithConflicts includes ?conflicts=true in URL and correctly encodes colons', async () => {
		const fetchSpy = vi.fn(mockFetch);
		vi.stubGlobal('fetch', fetchSpy);

		store.set('sop_profile_active:global', {
			_id: 'sop_profile_active:global',
			type: 'sop_profile_active',
			_conflicts: ['2-conflicting-leaf-revision']
		});

		const res = await getDocWithConflicts<{ _id: string }>('testdb', 'sop_profile_active:global');
		expect(res).not.toBeNull();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const calledUrlStr = String(fetchSpy.mock.calls[0][0]);
		const calledUrl = new URL(calledUrlStr);
		expect(calledUrl.searchParams.get('conflicts')).toBe('true');
		expect(calledUrl.pathname).toContain('sop_profile_active%3Aglobal');
	});

	it('getDocWithConflicts preserves _conflicts in returned data', async () => {
		store.set('sop_profile_active:global', {
			_id: 'sop_profile_active:global',
			type: 'sop_profile_active',
			_conflicts: ['2-conflicting-leaf-revision']
		});

		const res = await getDocWithConflicts<{ _id: string }>('testdb', 'sop_profile_active:global');
		expect(res?._conflicts).toEqual(['2-conflicting-leaf-revision']);
	});

	it('getDocWithConflicts returns null on 404', async () => {
		const res = await getDocWithConflicts<{ _id: string }>('testdb', 'sop_profile_active:missing');
		expect(res).toBeNull();
	});

	it('getDoc does not request ?conflicts=true and strips _conflicts from returned document', async () => {
		const fetchSpy = vi.fn(mockFetch);
		vi.stubGlobal('fetch', fetchSpy);

		store.set('sop_profile_active:global', {
			_id: 'sop_profile_active:global',
			type: 'sop_profile_active',
			_conflicts: ['2-conflicting-leaf-revision']
		});

		const res = await getDoc<{ _id: string }>('testdb', 'sop_profile_active:global');
		expect(res).not.toBeNull();

		const calledUrlStr = String(fetchSpy.mock.calls[0][0]);
		const calledUrl = new URL(calledUrlStr);
		expect(calledUrl.searchParams.has('conflicts')).toBe(false);
		expect((res as { _conflicts?: unknown })._conflicts).toBeUndefined();
	});
});
