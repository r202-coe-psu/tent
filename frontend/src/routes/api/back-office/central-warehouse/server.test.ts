import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$lib/server/couch-admin', () => ({ requireShelterScopeOrSA: vi.fn() }));
vi.mock('$lib/server/integrations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/integrations')>()),
	integrationRequest: vi.fn()
}));
vi.mock('$lib/features/central-warehouse/server/withdrawal.server', () => ({
	createWithdrawal: vi.fn(),
	cancelWithdrawal: vi.fn()
}));

const { requireShelterScopeOrSA } = await import('$lib/server/couch-admin');
const { integrationRequest, IntegrationError } = await import('$lib/server/integrations');
const { createWithdrawal, cancelWithdrawal } =
	await import('$lib/features/central-warehouse/server/withdrawal.server');
const warehouses = await import('./warehouses/+server');
const stock = await import('./warehouses/[code]/stock/+server');
const catalog = await import('./catalog/+server');
const withdrawals = await import('./withdrawals/+server');
const withdrawal = await import('./withdrawals/[code]/+server');
const cancel = await import('./withdrawals/[code]/cancel/+server');
const status = await import('../integrations/status/+server');

function event(opts: {
	search?: Record<string, string>;
	params?: Record<string, string>;
	body?: unknown;
}): never {
	const url = new URL('http://localhost/api/x');
	for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
	return {
		request: {
			headers: { get: (k: string) => (k.toLowerCase() === 'cookie' ? 'c=1' : null) },
			json: async () => opts.body ?? null
		},
		params: opts.params ?? {},
		url
	} as unknown as RequestEvent as never;
}

const asCaller = (roles: string[], isSA = false) =>
	vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
		name: 'u1',
		roles,
		isSA,
		shelterCode: isSA ? null : 'SH001'
	});

const WAREHOUSE = ['shelter:SH001', 'SH001:warehouse_staff'];
const MANAGER = ['shelter:SH001', 'SH001:shelter_manager'];

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(integrationRequest).mockResolvedValue({ data: [], total: 0 });
});

describe('authorization (M6 D2)', () => {
	const routes: [string, () => Promise<Response> | Response][] = [
		['warehouses', () => warehouses.GET(event({}))],
		['stock', () => stock.GET(event({ params: { code: 'WH1' } }))],
		['catalog', () => catalog.GET(event({ search: { q: 'น้ำ' } }))],
		['withdrawals list', () => withdrawals.GET(event({}))],
		['withdrawals create', () => withdrawals.POST(event({ body: {} }))],
		['withdrawal get', () => withdrawal.GET(event({ params: { code: 'WR-1' } }))],
		['withdrawal cancel', () => cancel.POST(event({ params: { code: 'WR-1' }, body: {} }))]
	];

	it.each(routes)('refuses supply_coordinator on %s', async (_label, call) => {
		asCaller(['shelter:SH001', 'SH001:supply_coordinator']);
		const res = await call();
		expect(res.status).toBe(403);
		expect(integrationRequest).not.toHaveBeenCalled();
		expect(createWithdrawal).not.toHaveBeenCalled();
	});

	it.each(routes)('refuses other staff on %s', async (_label, call) => {
		asCaller(['shelter:SH001', 'SH001:donation_staff']);
		expect((await call()).status).toBe(403);
	});

	it('refuses warehouse_staff of another shelter', async () => {
		asCaller(WAREHOUSE);
		const res = await warehouses.GET(event({ search: { shelter_code: 'SH002' } }));
		expect(res.status).toBe(403);
	});

	it('admits warehouse_staff, shelter_manager and SA', async () => {
		for (const [roles, sa] of [
			[WAREHOUSE, false],
			[MANAGER, false],
			[['system_admin'], true]
		] as const) {
			asCaller([...roles], sa);
			expect((await warehouses.GET(event({ search: { shelter_code: 'SH001' } }))).status).toBe(200);
		}
	});

	it('SA must name a shelter for shelter-scoped routes', async () => {
		asCaller(['system_admin'], true);
		expect((await withdrawals.GET(event({}))).status).toBe(400);
		expect((await withdrawals.GET(event({ search: { shelter_code: 'SH001' } }))).status).toBe(200);
	});
});

describe('read routes', () => {
	beforeEach(() => asCaller(WAREHOUSE));

	it('proxies warehouses with no-store', async () => {
		const res = await warehouses.GET(event({}));
		expect(integrationRequest).toHaveBeenCalledWith('GET', '/v1/integrations/m6/warehouses');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
	});

	it('forwards stock filters and encodes the code', async () => {
		await stock.GET(
			event({ params: { code: 'WH1' }, search: { type_code: 'water', search: ' น้ำ ' } })
		);
		expect(integrationRequest).toHaveBeenCalledWith(
			'GET',
			`/v1/integrations/m6/warehouses/WH1/stock?type_code=water&search=${encodeURIComponent('น้ำ')}`
		);
	});

	it('rejects a malformed warehouse code', async () => {
		for (const code of ['../x', '..', 'a b', 'x'.repeat(65)]) {
			const res = await stock.GET(event({ params: { code } }));
			expect(res.status).toBe(422);
		}
		expect(integrationRequest).not.toHaveBeenCalled();
	});

	it('forwards catalog params but not shelter_code', async () => {
		await catalog.GET(
			event({ search: { q: 'น้ำ', warehouse_code: 'WH1', shelter_code: 'SH001', junk: 'x' } })
		);
		const path = vi.mocked(integrationRequest).mock.calls[0][1];
		expect(path).toContain('/v1/integrations/m6/catalog/search?');
		expect(path).toContain('warehouse_code=WH1');
		expect(path).not.toContain('shelter_code');
		expect(path).not.toContain('junk');
	});

	it('lists withdrawals for the session shelter, whatever the client sends', async () => {
		await withdrawals.GET(event({ search: { shelter_code: 'SH001', status: 'pending' } }));
		expect(integrationRequest).toHaveBeenCalledWith(
			'GET',
			'/v1/integrations/m6/withdrawals?shelter_code=SH001&status=pending'
		);
	});

	it('reads one withdrawal scoped to the shelter', async () => {
		await withdrawal.GET(event({ params: { code: 'WR-1' } }));
		expect(integrationRequest).toHaveBeenCalledWith(
			'GET',
			'/v1/integrations/m6/withdrawals/WR-1?shelter_code=SH001'
		);
	});

	it('maps an integration error to { error, code, ...extra }', async () => {
		vi.mocked(integrationRequest).mockRejectedValue(
			new IntegrationError(503, 'M6_UNAVAILABLE', 'ใช้งานไม่ได้')
		);
		const res = await warehouses.GET(event({}));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: 'ใช้งานไม่ได้', code: 'M6_UNAVAILABLE' });
	});
});

describe('write routes', () => {
	beforeEach(() => asCaller(WAREHOUSE));

	it('create answers 201 and hands the session shelter to the orchestrator', async () => {
		vi.mocked(createWithdrawal).mockResolvedValue({ request_code: 'WR-1' } as never);
		const res = await withdrawals.POST(event({ body: { reason: 'x' } }));
		expect(res.status).toBe(201);
		expect(vi.mocked(createWithdrawal).mock.calls[0][0].shelterCode).toBe('SH001');
	});

	it('create surfaces SHELTER_LOCATION_MISSING as 422', async () => {
		vi.mocked(createWithdrawal).mockRejectedValue(
			new IntegrationError(422, 'SHELTER_LOCATION_MISSING', 'ตั้งพิกัดก่อน')
		);
		const res = await withdrawals.POST(event({ body: {} }));
		expect(res.status).toBe(422);
		expect((await res.json()).code).toBe('SHELTER_LOCATION_MISSING');
	});

	it('cancel hands code and body to the orchestrator; a stale cancel is 409', async () => {
		vi.mocked(cancelWithdrawal).mockRejectedValue(
			new IntegrationError(409, 'M6_NOT_CANCELLABLE', 'ยกเลิกไม่ได้')
		);
		const res = await cancel.POST(event({ params: { code: 'WR-1' }, body: { reason: 'x' } }));
		expect(res.status).toBe(409);
		expect(cancelWithdrawal).toHaveBeenCalledWith(
			expect.objectContaining({ shelterCode: 'SH001' }),
			'WR-1',
			{ reason: 'x' }
		);
	});
});

describe('integrations status audiences', () => {
	// `getIntegrationStatus` calls the module-internal request helper, so stub the network instead.
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					m5: { configured: true, token_ok: true, reachable: true },
					m6: { configured: true, token_ok: true, reachable: true, resource_types: ['food'] }
				})
			)
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		['warehouse_staff (central-warehouse audience)', WAREHOUSE],
		['shelter_manager', MANAGER],
		['medical_staff (referral audience)', ['shelter:SH001', 'SH001:medical_staff']]
	])('admits %s', async (_label, roles) => {
		asCaller(roles);
		const res = await status.GET(event({}));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			m5: { state: 'ready' },
			m6: { state: 'ready', resource_types: ['food'] }
		});
	});

	it('is 403 when neither audience admits the caller (supply_coordinator)', async () => {
		asCaller(['shelter:SH001', 'SH001:supply_coordinator']);
		expect((await status.GET(event({}))).status).toBe(403);
	});

	it('is 401 for an anonymous caller', async () => {
		vi.mocked(requireShelterScopeOrSA).mockRejectedValue(
			Object.assign(new Error('Authentication required'), { status: 401 })
		);
		expect((await status.GET(event({}))).status).toBe(401);
	});
});
