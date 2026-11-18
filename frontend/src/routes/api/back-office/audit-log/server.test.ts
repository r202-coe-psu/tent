import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	authorizeSession: sessionMock
}));
vi.mock('$lib/server/audit-log', () => ({ queryAuditLog: queryMock }));

import { GET } from './+server';

function call(search = '') {
	const url = new URL(`http://localhost/api/back-office/audit-log${search}`);
	const request = new Request(url, { headers: { cookie: 'AuthSession=x' } });
	return GET({ request, url } as unknown as Parameters<typeof GET>[0]);
}

const sm = (codes: string[]) => ({
	name: 'sm',
	roles: codes.flatMap((c) => [`shelter:${c}`, `${c}:shelter_manager`]),
	isSA: false,
	shelterCode: codes[0]
});

beforeEach(() => {
	sessionMock.mockReset();
	queryMock.mockReset().mockResolvedValue({ items: [], next_cursor: null });
});

describe('GET /api/back-office/audit-log (CR-259 FR-34/FR-35)', () => {
	it('lets a system admin read every shelter', async () => {
		sessionMock.mockResolvedValue({ name: 'sa', roles: ['system_admin'], isSA: true });
		const res = await call('?entity_type=user');
		expect(res.status).toBe(200);
		expect(queryMock.mock.calls[0][0]).toMatchObject({ entity_type: 'user', limit: 50 });
		expect(queryMock.mock.calls[0][0].shelter_code).toBeUndefined();
	});

	it('scopes a shelter manager to their only shelter when none is given', async () => {
		sessionMock.mockResolvedValue(sm(['SH001']));
		expect((await call()).status).toBe(200);
		expect(queryMock.mock.calls[0][0].shelter_code).toBe('SH001');
	});

	it('refuses a shelter manager asking for another shelter', async () => {
		sessionMock.mockResolvedValue(sm(['SH001']));
		expect((await call('?shelter_code=SH002')).status).toBe(403);
		expect(queryMock).not.toHaveBeenCalled();
	});

	it('asks a manager of several shelters to pick one', async () => {
		sessionMock.mockResolvedValue(sm(['SH001', 'SH002']));
		expect((await call()).status).toBe(422);
		expect((await call('?shelter_code=SH002')).status).toBe(200);
	});

	it('refuses other roles', async () => {
		sessionMock.mockResolvedValue({
			name: 'k',
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			isSA: false
		});
		expect((await call('?shelter_code=SH001')).status).toBe(403);
	});

	it('answers 422 for an invalid filter', async () => {
		sessionMock.mockResolvedValue({ name: 'sa', roles: ['system_admin'], isSA: true });
		expect((await call('?limit=999')).status).toBe(422);
	});
});
