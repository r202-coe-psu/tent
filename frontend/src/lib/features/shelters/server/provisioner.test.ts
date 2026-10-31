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

describe('provisionShelter seeding', () => {
	const ACCESS_VDU = 'function (newDoc, oldDoc, userCtx) {}';

	/** A PUT/POST that writes an evacuee doc: by doc-id path or by `type` in the body (incl. _bulk_docs). */
	function isEvacueeWrite(path: string, body: unknown): boolean {
		if (decodeURIComponent(path).includes('evacuee:')) return true;
		const docs =
			body && typeof body === 'object' && Array.isArray((body as { docs?: unknown }).docs)
				? (body as { docs: unknown[] }).docs
				: [body];
		return docs.some(
			(doc) =>
				doc !== null && typeof doc === 'object' && (doc as { type?: unknown }).type === 'evacuee'
		);
	}

	// Stateful store so PUTs are readable back: a seed write that succeeds must be
	// observable, otherwise the test could pass for the wrong reason.
	let docs: Map<string, unknown>;

	beforeEach(() => {
		docs = new Map<string, unknown>();
		adminRawMock.mockReset();
		deployRegistryDesignMock.mockReset().mockResolvedValue({ status: 201, updated: true });
		findMasterByNameMock.mockReset().mockResolvedValue(null);
		findMasterByCodeMock.mockReset().mockResolvedValue(null);
		mergeShelterSecurityMock.mockReset().mockResolvedValue(undefined);
		adminRawMock.mockImplementation(async (path: string, method: string, body?: unknown) => {
			if (method === 'GET' && path === '/catalog') {
				return { status: 200, data: { db_name: 'catalog' } };
			}
			if (method === 'GET' && path === '/catalog/_design/access') {
				return { status: 200, data: { validate_doc_update: ACCESS_VDU } };
			}
			if (method === 'GET' && path.includes('/_view/')) {
				return { status: 200, data: { rows: [] } };
			}
			const key = decodeURIComponent(path);
			if (method === 'PUT') {
				docs.set(key, body);
				return { status: 201, data: { ok: true } };
			}
			if (method === 'GET') {
				return docs.has(key)
					? { status: 200, data: docs.get(key) }
					: { status: 404, data: { reason: 'missing' } };
			}
			return { status: 201, data: { ok: true } };
		});
	});

	function writtenMaster(): Record<string, unknown> {
		const entry = [...docs].find(([key]) => key.startsWith('/registry/shelter:'));
		if (!entry) throw new Error('no registry master was written');
		return entry[1] as Record<string, unknown>;
	}

	it('creates a shelter without writing evacuee docs or seed:* steps', async () => {
		const result = await provisionShelter(
			{ name: 'ศูนย์ทดสอบ' } as Parameters<typeof provisionShelter>[0],
			'SH001'
		);

		expect(result.ok).toBe(true);
		const evacueeWrites = adminRawMock.mock.calls
			.filter(([, method]) => method === 'PUT' || method === 'POST')
			.filter(([path, , body]) => isEvacueeWrite(path as string, body))
			.map(([path, method]) => `${method} ${path}`);
		expect(evacueeWrites).toEqual([]);
		expect(result.steps.filter((step) => step.step.startsWith('seed:'))).toEqual([]);
	});

	it('stamps closed_at when a shelter is created already closed (CR-183 FR-14)', async () => {
		await provisionShelter(
			{ name: 'ศูนย์ปิด', operation_status: 'closed' } as Parameters<typeof provisionShelter>[0],
			'SH002'
		);

		expect(writtenMaster().closed_at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
	});

	it('ignores a client closed_at on create', async () => {
		await provisionShelter(
			{
				name: 'ศูนย์เปิด',
				operation_status: 'active',
				closed_at: '2020-01-01T00:00:00.000Z'
			} as Parameters<typeof provisionShelter>[0],
			'SH003'
		);

		expect(writtenMaster().closed_at).toBeNull();
	});
});
