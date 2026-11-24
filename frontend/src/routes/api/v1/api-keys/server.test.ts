import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordProxiedWrite, requireSystemAdmin, authorizeUserWrite } = vi.hoisted(() => ({
	recordProxiedWrite: vi.fn<(res: Response, write: unknown) => Promise<void>>(
		async () => undefined
	),
	requireSystemAdmin: vi.fn(async () => ({ name: 'sa', roles: ['system_admin'], isSA: true })),
	authorizeUserWrite: vi.fn(async () => ({ name: 'sa', roles: ['system_admin'], isSA: true }))
}));

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	requireSystemAdmin,
	authorizeUserWrite
}));
vi.mock('$lib/server/audit-log', () => ({ recordProxiedWrite }));
vi.mock('$lib/server/fastapi', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/fastapi')>()),
	fastapiBaseUrl: () => 'http://fastapi.test',
	fastapiServiceHeaders: (extra: Record<string, string> = {}) => extra
}));

import { POST } from './+server';
import { POST as REVOKE } from './[id]/revoke/+server';

const upstream = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', upstream);

function post(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/v1/api-keys', {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify(body)
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}

function revoke(id: string) {
	const request = new Request(`http://localhost/api/v1/api-keys/${id}/revoke`, {
		method: 'POST',
		headers: { cookie: 'AuthSession=x' }
	});
	return REVOKE({ request, params: { id } } as unknown as Parameters<typeof REVOKE>[0]);
}

const futureIso = new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
	vi.clearAllMocks();
	requireSystemAdmin.mockResolvedValue({ name: 'sa', roles: ['system_admin'], isSA: true });
	authorizeUserWrite.mockResolvedValue({ name: 'sa', roles: ['system_admin'], isSA: true });
	upstream.mockResolvedValue(
		new Response(JSON.stringify({ id: 'key-1', name: 'EOC' }), {
			status: 201,
			headers: { 'content-type': 'application/json' }
		})
	);
});

describe('POST /api/v1/api-keys — CR-259 FR-24 audit wiring', () => {
	it('records api_key.created once the upstream write is proxied', async () => {
		await post({ name: 'EOC', owner: 'ศูนย์ EOC', expires_at: futureIso });

		expect(recordProxiedWrite).toHaveBeenCalledTimes(1);
		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			actor: 'sa',
			event: 'api_key.created',
			action: 'create',
			entityType: 'api_key',
			label: 'EOC',
			shelterCode: null
		});
	});

	it('records nothing when the request never reaches the upstream', async () => {
		await post({ owner: 'ศูนย์ EOC', expires_at: futureIso });

		expect(upstream).not.toHaveBeenCalled();
		expect(recordProxiedWrite).not.toHaveBeenCalled();
	});
});

describe('POST /api/v1/api-keys/[id]/revoke — CR-259 FR-24 audit wiring', () => {
	it('records api_key.revoked for the key in the path', async () => {
		upstream.mockResolvedValue(
			new Response(JSON.stringify({ id: 'key-1' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await revoke('key-1');

		expect(recordProxiedWrite).toHaveBeenCalledTimes(1);
		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			actor: 'sa',
			event: 'api_key.revoked',
			action: 'status_change',
			entityType: 'api_key',
			entityId: 'key-1',
			shelterCode: null
		});
	});

	it('records nothing when a non-admin is refused', async () => {
		authorizeUserWrite.mockResolvedValue({ name: 'sm', roles: ['shelter:SH001'], isSA: false });

		await revoke('key-1');

		expect(upstream).not.toHaveBeenCalled();
		expect(recordProxiedWrite).not.toHaveBeenCalled();
	});
});
