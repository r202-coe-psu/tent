import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { GET } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	adminRaw: vi.fn()
}));

const shelter = (code: string, name: string, extra: Record<string, unknown> = {}) => ({
	id: `shelter:${code}`,
	doc: { _id: `shelter:${code}`, type: 'shelter', code, name, ...extra }
});

const REGISTRY = {
	rows: [
		shelter('SH001', 'ศูนย์หนึ่ง'),
		shelter('SH002', 'ศูนย์สอง', { operation_status: 'active' }),
		shelter('SH003', 'ศูนย์สาม', { operation_status: 'closed' }),
		shelter('SH004', 'ศูนย์ที่สร้างผิด', { operation_status: 'cancelled' }),
		shelter('SH002', 'ศูนย์สอง (ซ้ำ)'),
		{ id: 'config:app', doc: { _id: 'config:app', type: 'config' } }
	]
};

function event(searchParams: Record<string, string> = {}): RequestEvent {
	const url = new URL('http://localhost/api/back-office/transfer/destinations');
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
	return {
		request: { headers: { get: (key: string) => (key === 'cookie' ? 'AuthSession=x' : null) } },
		url
	} as unknown as RequestEvent;
}

function caller(roles: string[], shelterCode: string | null = 'SH001', isSA = false) {
	vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
		name: 'tester',
		roles,
		isSA,
		shelterCode
	} as Awaited<ReturnType<typeof requireShelterScopeOrSA>>);
}

describe('GET /api/back-office/transfer/destinations (#570)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: REGISTRY });
	});

	it.each([
		['warehouse_staff', ['SH001:warehouse_staff', 'shelter:SH001']],
		['shelter_manager', ['SH001:shelter_manager', 'shelter:SH001']]
	])('gives %s every other shelter, without its own or a cancelled one', async (_, roles) => {
		caller(roles);

		const res = await GET(event());

		expect(res.status).toBe(200);
		// Sorted by Thai name; the duplicate SH002 row keeps its first name.
		expect(await res.json()).toEqual([
			{ code: 'SH002', name: 'ศูนย์สอง' },
			{ code: 'SH003', name: 'ศูนย์สาม' }
		]);
	});

	it('answers code and name only', async () => {
		caller(['SH001:warehouse_staff', 'shelter:SH001']);
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { rows: [shelter('SH009', 'ศูนย์เก้า', { contact: { phone: '0812345678' } })] }
		});

		const [only] = await (await GET(event())).json();

		expect(Object.keys(only).sort()).toEqual(['code', 'name']);
	});

	it('leaves out the shelter_code a system_admin is acting for', async () => {
		caller(['_admin'], null, true);

		const res = await GET(event({ shelter_code: 'SH002' }));

		expect((await res.json()).map((s: { code: string }) => s.code)).toEqual(['SH003', 'SH001']);
	});

	it('asks a system_admin for the shelter it is acting for', async () => {
		caller(['_admin'], null, true);

		expect((await GET(event())).status).toBe(400);
	});

	it('refuses a role the transfer API does not accept', async () => {
		caller(['SH001:registration_staff', 'shelter:SH001']);

		expect((await GET(event())).status).toBe(403);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('refuses a caller with no session', async () => {
		vi.mocked(requireShelterScopeOrSA).mockImplementation(async () => {
			error(401, 'Not signed in');
		});

		expect((await GET(event())).status).toBe(401);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('reports a registry it cannot read instead of an empty list', async () => {
		caller(['SH001:warehouse_staff', 'shelter:SH001']);
		vi.mocked(adminRaw).mockResolvedValue({ status: 500, data: null });

		expect((await GET(event())).status).toBe(502);
	});
});
