import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminRawMock = vi.hoisted(() => vi.fn());
const deployRegistryDesignMock = vi.hoisted(() => vi.fn());
const findHighestShelterCodeNumberMock = vi.hoisted(() => vi.fn());
const findMasterByCodeMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: adminRawMock
}));

vi.mock('$lib/server/shelters.admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/shelters.admin')>()),
	deployRegistryDesign: deployRegistryDesignMock,
	findHighestShelterCodeNumber: findHighestShelterCodeNumberMock,
	findMasterByCode: findMasterByCodeMock
}));

import { allocateShelterCode } from './provisioner';

describe('allocateShelterCode', () => {
	beforeEach(() => {
		adminRawMock.mockReset();
		deployRegistryDesignMock.mockReset().mockResolvedValue({ status: 201, updated: true });
		findHighestShelterCodeNumberMock.mockReset().mockResolvedValue(0);
		findMasterByCodeMock.mockReset().mockResolvedValue(null);

		adminRawMock.mockImplementation(async (path: string, method: string) => {
			if (path === '/registry' && method === 'PUT') return { status: 201, data: { ok: true } };
			if (path === '/registry/counter%3Ashelter' && method === 'GET') {
				return { status: 404, data: { reason: 'missing' } };
			}
			if (path === '/registry/shelter_sequence_bootstrap_lock' && method === 'GET') {
				return { status: 404, data: { reason: 'missing' } };
			}
			if (path === '/registry/shelter_sequence_bootstrap_lock' && method === 'PUT') {
				return { status: 201, data: { ok: true } };
			}
			if (path === '/registry/shelter_sequence' && method === 'GET') {
				return { status: 404, data: { reason: 'missing' } };
			}
			if (path === '/registry/counter%3Ashelter' && method === 'PUT') {
				return { status: 201, data: { ok: true } };
			}
			return { status: 404, data: { reason: 'missing' } };
		});
	});

	it('bootstraps the counter when the post-lock read is missing', async () => {
		await expect(allocateShelterCode()).resolves.toBe('SH001');

		const counterWrite = adminRawMock.mock.calls.find(
			([path, method]) => path === '/registry/counter%3Ashelter' && method === 'PUT'
		);
		expect(counterWrite?.[2]).toMatchObject({
			_id: 'counter:shelter',
			type: 'shelter_counter',
			value: 1
		});
	});
});
