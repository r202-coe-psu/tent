import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureCentralDatabases } from './bootstrap-db';
import * as couchAdmin from './couch-admin';
import * as sheltersAdmin from './shelters.admin';

describe('ensureCentralDatabases', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('creates missing central databases and deploys security and design docs', async () => {
		const putCalls: string[] = [];
		const getCalls: string[] = [];

		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method) => {
			if (method === 'PUT') {
				putCalls.push(path);
				return { status: 201, data: { ok: true } };
			}
			if (method === 'GET') {
				getCalls.push(path);
				return { status: 404, data: null };
			}
			if (method === 'POST') {
				return { status: 200, data: { ok: true } };
			}
			return { status: 200, data: null };
		});

		const mergeSecuritySpy = vi
			.spyOn(sheltersAdmin, 'mergeShelterSecurity')
			.mockResolvedValue(undefined);
		const deployRegistrySpy = vi
			.spyOn(sheltersAdmin, 'deployRegistryDesign')
			.mockResolvedValue({ status: 201, updated: true });

		await ensureCentralDatabases();

		expect(putCalls).toContain('/catalog');
		expect(putCalls).toContain('/registry');
		expect(putCalls).toContain('/thailand_locations');
		expect(putCalls).toContain('/catalog/_design/access');
		expect(putCalls).toContain('/catalog/sop_profile%3Amaster_sphere_baseline');

		expect(mergeSecuritySpy).toHaveBeenCalledWith('registry', expect.anything(), expect.anything());
		expect(mergeSecuritySpy).toHaveBeenCalledWith('catalog', expect.anything(), expect.anything());
		expect(deployRegistrySpy).toHaveBeenCalled();
	});

	it('handles existing databases gracefully without crashing', async () => {
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (_path, method) => {
			if (method === 'PUT') {
				return { status: 412, data: { error: 'file_exists' } };
			}
			if (method === 'GET') {
				return { status: 200, data: { schema_v: 1 } };
			}
			return { status: 200, data: null };
		});

		vi.spyOn(sheltersAdmin, 'mergeShelterSecurity').mockResolvedValue(undefined);
		vi.spyOn(sheltersAdmin, 'deployRegistryDesign').mockResolvedValue({
			status: 200,
			updated: false
		});

		await expect(ensureCentralDatabases()).resolves.not.toThrow();
	});

	it('catches and suppresses connection failures gracefully', async () => {
		vi.spyOn(couchAdmin, 'adminRaw').mockRejectedValue(
			new Error('fetch failed: connection refused')
		);

		await expect(ensureCentralDatabases()).resolves.not.toThrow();
	});
});
