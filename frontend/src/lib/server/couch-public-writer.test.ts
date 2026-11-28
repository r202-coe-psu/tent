import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { COUCHDB_PUBLIC_WRITER_URL: 'http://public_writer:secret@couch:5984' }
}));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

import { bulkAsPublicWriter, putAsPublicWriter } from './couch-public-writer';

let bodies: unknown[] = [];

beforeEach(() => {
	bodies = [];
	vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
		const body = JSON.parse(String(init.body));
		bodies.push(body);
		if (String(url).endsWith('/_bulk_docs')) {
			const docs = (body as { docs: { _id: string }[] }).docs;
			return new Response(JSON.stringify(docs.map((d) => ({ id: d._id, ok: true, rev: '1-a' }))));
		}
		return new Response(JSON.stringify({ ok: true, rev: '1-a' }), { status: 201 });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('public writer updated_by stamp (CR-260)', () => {
	it('names the public writer on a shelter write', async () => {
		await putAsPublicWriter('shelter_sh001', 'donation:01', { _id: 'donation:01' });
		expect(bodies[0]).toMatchObject({ updated_by: 'public_writer' });
	});

	it('names the public writer on every doc of a shelter bulk write', async () => {
		await bulkAsPublicWriter('shelter_sh001', [{ _id: 'household:01' }, { _id: 'evacuee:01' }]);
		const docs = (bodies[0] as { docs: Record<string, unknown>[] }).docs;
		expect(docs.every((d) => d.updated_by === 'public_writer')).toBe(true);
	});

	it('leaves databases that do not track the writer alone', async () => {
		await putAsPublicWriter('registry', 'volunteer_application:01', {
			_id: 'volunteer_application:01'
		});
		await bulkAsPublicWriter('volunteers', [{ _id: 'ticket:01' }]);
		expect(bodies[0]).not.toHaveProperty('updated_by');
		expect((bodies[1] as { docs: object[] }).docs[0]).not.toHaveProperty('updated_by');
	});
});
