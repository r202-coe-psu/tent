import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminRawMock = vi.hoisted(() => vi.fn());
const deployRegistryDesignMock = vi.hoisted(() => vi.fn());
const findHighestShelterCodeNumberMock = vi.hoisted(() => vi.fn());
const findMasterByCodeMock = vi.hoisted(() => vi.fn());
const mergeShelterSecurityMock = vi.hoisted(() => vi.fn());
const findMasterByNameMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: adminRawMock
}));

vi.mock('$lib/server/shelters.admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/shelters.admin')>()),
	deployRegistryDesign: deployRegistryDesignMock,
	findHighestShelterCodeNumber: findHighestShelterCodeNumberMock,
	findMasterByCode: findMasterByCodeMock,
	findMasterByName: findMasterByNameMock,
	mergeShelterSecurity: mergeShelterSecurityMock
}));

vi.mock('$lib/server/shelter-name-lock', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/shelter-name-lock')>()),
	acquireShelterNameLock: vi.fn(async () => true),
	isShelterNameLockHeld: vi.fn(async () => true),
	releaseShelterNameLock: vi.fn(async () => undefined)
}));

import { allocateShelterCode, grantCatalogShelterScope, provisionShelter } from './provisioner';

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

	it('reconciles a stale counter when a legacy code is far ahead', async () => {
		let counter = { _id: 'counter:shelter', _rev: '1-counter', type: 'shelter_counter', value: 1 };
		adminRawMock.mockImplementation(
			async (path: string, method: string, body?: Record<string, unknown>) => {
				if (path === '/registry' && method === 'PUT') return { status: 201, data: { ok: true } };
				if (path === '/registry/counter%3Ashelter' && method === 'GET') {
					return { status: 200, data: counter };
				}
				if (path === '/registry/counter%3Ashelter' && method === 'PUT') {
					if (body?._rev !== counter._rev) return { status: 409, data: { reason: 'conflict' } };
					counter = {
						...counter,
						value: Number(body.value),
						_rev: `${Number(counter._rev[0]) + 1}-counter`
					};
					return { status: 201, data: { ok: true } };
				}
				return { status: 404, data: { reason: 'missing' } };
			}
		);
		findHighestShelterCodeNumberMock.mockResolvedValue(10);
		findMasterByCodeMock.mockImplementation(async (code: string) =>
			code === 'SH002' ? { code } : null
		);

		await expect(allocateShelterCode()).resolves.toBe('SH011');
		expect(counter.value).toBe(11);
	});
});

describe('grantCatalogShelterScope', () => {
	const ACCESS_VDU = 'function (newDoc, oldDoc, userCtx) {}';

	function catalogDouble(options: { db?: number; design?: number; designDoc?: unknown }) {
		adminRawMock.mockImplementation(async (path: string, method: string) => {
			if (path === '/catalog' && method === 'GET') {
				return { status: options.db ?? 200, data: { db_name: 'catalog' } };
			}
			if (path === '/catalog/_design/access' && method === 'GET') {
				return {
					status: options.design ?? 200,
					data: options.designDoc ?? { validate_doc_update: ACCESS_VDU }
				};
			}
			return { status: 500, data: { reason: `unexpected ${method} ${path}` } };
		});
	}

	beforeEach(() => {
		adminRawMock.mockReset();
		mergeShelterSecurityMock.mockReset().mockResolvedValue(undefined);
	});

	it('merges only the new shelter scope into catalog members', async () => {
		catalogDouble({});
		const assertActive = vi.fn(async () => {});

		await expect(grantCatalogShelterScope('SH007', assertActive)).resolves.toEqual({
			step: 'catalog-security',
			status: 200
		});
		expect(mergeShelterSecurityMock).toHaveBeenCalledWith(
			'catalog',
			{ roles: ['system_admin'] },
			{ roles: ['shelter:SH007'] },
			{ assertActive }
		);
	});

	it('skips when the catalog database does not exist yet', async () => {
		catalogDouble({ db: 404 });

		await expect(grantCatalogShelterScope('SH007')).resolves.toEqual({
			step: 'catalog-security',
			status: 404
		});
		expect(mergeShelterSecurityMock).not.toHaveBeenCalled();
	});

	it.each([
		['the design doc is missing', { design: 404, designDoc: { error: 'not_found' } }],
		['the design doc has no validate_doc_update', { designDoc: { _id: '_design/access' } }]
	])('fails closed when %s', async (_label, options) => {
		catalogDouble(options);

		await expect(grantCatalogShelterScope('SH007')).rejects.toThrow(/no write policy/);
		expect(mergeShelterSecurityMock).not.toHaveBeenCalled();
	});

	it('surfaces an unreadable catalog instead of skipping', async () => {
		catalogDouble({ db: 500 });

		await expect(grantCatalogShelterScope('SH007')).rejects.toThrow(/catalog database failed/);
		expect(mergeShelterSecurityMock).not.toHaveBeenCalled();
	});
});

describe('provisionShelter catalog write-policy precondition', () => {
	beforeEach(() => {
		adminRawMock.mockReset();
		deployRegistryDesignMock.mockReset().mockResolvedValue({ status: 304, updated: false });
		findMasterByNameMock.mockReset().mockResolvedValue(null);
		mergeShelterSecurityMock.mockReset().mockResolvedValue(undefined);
	});

	it('fails before allocating a code or creating any shelter DB', async () => {
		adminRawMock.mockImplementation(async (path: string, method: string) => {
			if (path === '/registry' && method === 'PUT') return { status: 412, data: {} };
			if (path === '/catalog' && method === 'GET') return { status: 200, data: {} };
			if (path === '/catalog/_design/access' && method === 'GET') {
				return { status: 404, data: { error: 'not_found' } };
			}
			return { status: 500, data: { reason: `unexpected ${method} ${path}` } };
		});

		await expect(
			provisionShelter({ name: 'ศูนย์ทดสอบ' } as Parameters<typeof provisionShelter>[0])
		).rejects.toThrow(/no write policy/);

		const touched = adminRawMock.mock.calls.map(([path, method]) => `${method} ${path}`);
		expect(touched.some((call) => call.includes('/shelter_'))).toBe(false);
		expect(touched.some((call) => call.includes('counter'))).toBe(false);
		expect(findMasterByNameMock).not.toHaveBeenCalled();
		expect(mergeShelterSecurityMock).not.toHaveBeenCalled();
	});
});
