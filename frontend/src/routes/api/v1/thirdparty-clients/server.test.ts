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
import { PATCH, DELETE } from './[id]/+server';
import { POST as REVOKE } from './[id]/revoke/+server';
import { POST as REGENERATE } from './[id]/regenerate-secret/+server';

const upstream = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', upstream);

function call<T>(method: string, path: string, body?: unknown, id?: string): T {
	const request = new Request(`http://localhost/api/v1/thirdparty-clients${path}`, {
		method,
		headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	return { request, params: id ? { id } : {} } as unknown as T;
}

const SA = { name: 'sa', roles: ['system_admin'], isSA: true };
const SM = { name: 'sm', roles: ['shelter:SH001'], isSA: false };

beforeEach(() => {
	vi.clearAllMocks();
	requireSystemAdmin.mockResolvedValue(SA);
	authorizeUserWrite.mockResolvedValue(SA);
	upstream.mockResolvedValue(
		new Response(JSON.stringify({ id: 'client-1', client: { name: 'พันธมิตร ก' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		})
	);
});

describe('thirdparty-clients — CR-259 FR-24 audit wiring', () => {
	it('POST records thirdparty_client.created', async () => {
		await POST(
			call<Parameters<typeof POST>[0]>('POST', '', {
				name: 'พันธมิตร ก',
				allowed_scopes: ['occupants:read']
			})
		);

		expect(recordProxiedWrite).toHaveBeenCalledTimes(1);
		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			actor: 'sa',
			event: 'thirdparty_client.created',
			action: 'create',
			entityType: 'thirdparty_client',
			label: 'พันธมิตร ก'
		});
	});

	it('PATCH records thirdparty_client.updated for the client in the path', async () => {
		await PATCH(
			call<Parameters<typeof PATCH>[0]>(
				'PATCH',
				'/client-1',
				{ allowed_scopes: ['occupants:read'] },
				'client-1'
			)
		);

		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			event: 'thirdparty_client.updated',
			action: 'update',
			entityId: 'client-1'
		});
	});

	it('DELETE records thirdparty_client.deleted', async () => {
		await DELETE(call<Parameters<typeof DELETE>[0]>('DELETE', '/client-1', undefined, 'client-1'));

		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			event: 'thirdparty_client.deleted',
			action: 'delete',
			entityId: 'client-1'
		});
	});

	it('revoke records a status change', async () => {
		await REVOKE(
			call<Parameters<typeof REVOKE>[0]>('POST', '/client-1/revoke', undefined, 'client-1')
		);

		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			event: 'thirdparty_client.updated',
			action: 'status_change',
			entityId: 'client-1'
		});
	});

	it('regenerate-secret records an update', async () => {
		await REGENERATE(
			call<Parameters<typeof REGENERATE>[0]>(
				'POST',
				'/client-1/regenerate-secret',
				undefined,
				'client-1'
			)
		);

		expect(recordProxiedWrite.mock.calls[0][1]).toMatchObject({
			event: 'thirdparty_client.updated',
			action: 'update',
			entityId: 'client-1'
		});
	});

	it('records nothing when a non-admin is refused', async () => {
		authorizeUserWrite.mockResolvedValue(SM);

		await PATCH(
			call<Parameters<typeof PATCH>[0]>(
				'PATCH',
				'/client-1',
				{ allowed_scopes: ['occupants:read'] },
				'client-1'
			)
		);

		expect(upstream).not.toHaveBeenCalled();
		expect(recordProxiedWrite).not.toHaveBeenCalled();
	});

	it('records nothing when the body fails validation', async () => {
		await POST(call<Parameters<typeof POST>[0]>('POST', '', { name: 'พันธมิตร ก' }));

		expect(upstream).not.toHaveBeenCalled();
		expect(recordProxiedWrite).not.toHaveBeenCalled();
	});
});
