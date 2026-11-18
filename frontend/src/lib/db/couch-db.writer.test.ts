// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: { name: 'sm.user' } as { name: string } | null }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return auth.user;
		},
		handleAuthFailure: vi.fn()
	}
}));
vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: { markConnected: vi.fn(), markDisconnected: vi.fn() }
}));

import { bulkDocs, bulkDocsDetailed, deleteDoc, putDoc } from './couch-db';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

beforeEach(() => {
	auth.user = { name: 'sm.user' };
	calls = [];
	vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
		const body = init.body ? JSON.parse(String(init.body)) : null;
		calls.push({ url: String(url), method: init.method ?? 'GET', body });
		if (String(url).endsWith('/_bulk_docs')) {
			const docs = (body as { docs: { _id: string }[] }).docs;
			return new Response(JSON.stringify(docs.map((d) => ({ id: d._id, rev: '1-bulk' }))), {
				status: 201
			});
		}
		return new Response(JSON.stringify({ ok: true, id: 'x', rev: '2-b' }), { status: 201 });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('updated_by stamping (CR-260 FR-C3/FR-C4)', () => {
	it('stamps the logged-in user on shelter and catalog writes, over a client value', async () => {
		const saved = await putDoc('shelter_sh001', {
			_id: 'evacuee:01',
			updated_by: 'mallory'
		} as { _id: string; updated_by: string });
		expect(calls[0].body).toMatchObject({ updated_by: 'sm.user' });
		expect(saved).toMatchObject({ updated_by: 'sm.user', _rev: '2-b' });

		await putDoc('catalog', { _id: 'item_master:01' });
		expect(calls[1].body).toMatchObject({ updated_by: 'sm.user' });
	});

	it('leaves other databases alone', async () => {
		await putDoc('registry', { _id: 'kiosk_banner:01' });
		expect(calls[0].body).not.toHaveProperty('updated_by');
	});

	it('does not stamp when nobody is logged in', async () => {
		auth.user = null;
		await putDoc('shelter_sh001', { _id: 'evacuee:01' });
		expect(calls[0].body).not.toHaveProperty('updated_by');
	});

	it('stamps every doc of a bulk write', async () => {
		await bulkDocs('shelter_sh001', [{ _id: 'a:1' }, { _id: 'a:2' }]);
		await bulkDocsDetailed('shelter_sh001', [{ _id: 'a:3' }]);
		const sent = calls.flatMap((c) => (c.body as { docs: Record<string, unknown>[] }).docs);
		expect(sent.every((d) => d.updated_by === 'sm.user')).toBe(true);
	});

	it('deletes shelter docs with a tombstone that names the deleter', async () => {
		await deleteDoc('shelter_sh001', { _id: 'recipe:01', _rev: '3-c' });
		expect(calls[0].method).toBe('PUT');
		expect(calls[0].url).not.toContain('?rev=');
		expect(calls[0].body).toMatchObject({
			_id: 'recipe:01',
			_rev: '3-c',
			_deleted: true,
			updated_by: 'sm.user'
		});
	});

	it('keeps HTTP DELETE for other databases', async () => {
		await deleteDoc('registry', { _id: 'kiosk_banner:01', _rev: '3-c' });
		expect(calls[0].method).toBe('DELETE');
		expect(calls[0].url).toContain('?rev=3-c');
	});
});
