import { describe, expect, it, vi } from 'vitest';

import type { CouchReq } from './ensure-public-writer';
import { buildRegistryDesignDoc } from './registry-design';
import { deployRegistryDesign, listShelterMasters, redeployRegistry } from './registry-redeploy';

const DESIGN_PATH = '/registry/_design/app';

/** In-memory CouchDB double for the registry DB. */
function registryDouble(options: { design?: Record<string, unknown>; shelters?: string[] } = {}) {
	const calls: { method: string; path: string; body?: unknown }[] = [];
	const couchReq: CouchReq = vi.fn(async (method, path, body) => {
		calls.push({ method, path, body });
		if (method === 'GET' && path === DESIGN_PATH) {
			return options.design
				? { status: 200, data: options.design }
				: { status: 404, data: { error: 'not_found' } };
		}
		if (method === 'PUT' && path === DESIGN_PATH) {
			return { status: 201, data: { ok: true } };
		}
		if (method === 'GET' && path === '/registry/_all_docs?include_docs=true') {
			const rows = (options.shelters ?? []).map((code) => ({
				id: `shelter:${code}`,
				doc: { code }
			}));
			return { status: 200, data: { rows } };
		}
		return { status: 500, data: null };
	});
	return { couchReq, calls };
}

describe('redeployRegistry', () => {
	it('deploys the registry design in write mode even when the registry has no shelters', async () => {
		const { couchReq, calls } = registryDouble();

		const result = await redeployRegistry(couchReq, false);

		expect(result).toEqual({ design: 'deployed', masters: [] });
		const put = calls.find((c) => c.method === 'PUT');
		expect(put?.path).toBe(DESIGN_PATH);
		expect(put?.body).toMatchObject({ _id: '_design/app' });
		expect(Object.keys((put?.body as { views: object }).views)).toEqual(
			expect.arrayContaining(['by_code', 'by_code_number', 'by_name'])
		);
	});

	it('reports the registry design as pending without writing in dry-run when empty', async () => {
		const { couchReq, calls } = registryDouble();

		const result = await redeployRegistry(couchReq, true);

		expect(result).toEqual({ design: 'deployed', masters: [] });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('deploys the design before listing shelters', async () => {
		const { couchReq, calls } = registryDouble({ shelters: ['SH001'] });

		const result = await redeployRegistry(couchReq, false);

		expect(result.masters).toEqual([{ code: 'SH001' }]);
		const putIndex = calls.findIndex((c) => c.method === 'PUT');
		const listIndex = calls.findIndex((c) => c.path.includes('_all_docs'));
		expect(putIndex).toBeGreaterThanOrEqual(0);
		expect(putIndex).toBeLessThan(listIndex);
	});
});

describe('deployRegistryDesign', () => {
	it('skips the PUT when the deployed design is already current', async () => {
		const current = { ...buildRegistryDesignDoc(), _rev: '1-abc' };
		const { couchReq, calls } = registryDouble({ design: current });

		await expect(deployRegistryDesign(couchReq, false)).resolves.toBe('current');
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('updates a stale design using its _rev', async () => {
		const stale = { ...buildRegistryDesignDoc(), version: 0, _rev: '1-old' };
		const { couchReq, calls } = registryDouble({ design: stale });

		await expect(deployRegistryDesign(couchReq, false)).resolves.toBe('deployed');
		expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ _rev: '1-old' });
	});

	it('throws a readable error when the registry database is missing in write mode', async () => {
		const couchReq: CouchReq = vi.fn(async (method) =>
			method === 'GET'
				? { status: 404, data: { error: 'not_found' } }
				: { status: 404, data: { error: 'not_found', reason: 'Database does not exist.' } }
		);

		await expect(deployRegistryDesign(couchReq, false)).rejects.toThrow(
			'registry _design/app deploy failed (404): Database does not exist.'
		);
	});
});

describe('listShelterMasters', () => {
	it('returns an empty list when the registry database does not exist', async () => {
		const couchReq: CouchReq = vi.fn(async () => ({ status: 404, data: null }));
		await expect(listShelterMasters(couchReq)).resolves.toEqual([]);
	});

	it('keeps only shelter master docs that carry a code', async () => {
		const couchReq: CouchReq = vi.fn(async () => ({
			status: 200,
			data: {
				rows: [
					{ id: 'shelter:01', doc: { code: 'SH001' } },
					{ id: 'shelter:02', doc: {} },
					{ id: '_design/app', doc: { code: 'X' } }
				]
			}
		}));
		await expect(listShelterMasters(couchReq)).resolves.toEqual([{ code: 'SH001' }]);
	});
});
