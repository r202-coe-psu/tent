import { error } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { printDeviceRepository } from '$lib/server/printers/printer-server';
import type { PrintDeviceDoc } from '$lib/server/printers/device-credentials';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, requireShelterScopeOrSA: vi.fn() };
});

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { listDevices: vi.fn() },
	printJobStore: {}
}));

describe('GET /api/staff/v1/printers', () => {
	const mockAuth = vi.mocked(requireShelterScopeOrSA);
	const mockList = vi.mocked(printDeviceRepository.listDevices);

	const device = (device_id: string, overrides: Partial<PrintDeviceDoc> = {}): PrintDeviceDoc => ({
		_id: `print_device:${device_id}`,
		_rev: '3-c',
		type: 'print_device',
		schema_v: 1,
		device_id,
		name: device_id,
		shelter_code: 'SH001',
		station: null,
		host_kind: 'standalone',
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_print_01234567',
		status: 'active',
		last_seen_at: '2026-10-22T02:59:50.000Z',
		queue_state: 'ready',
		agent_version: '0.1.0',
		created_at: '2026-10-22T00:00:00.000Z',
		updated_at: '2026-10-22T02:59:50.000Z',
		created_by: 'sa-user',
		...overrides
	});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-22T03:00:00.000Z'));
		mockAuth.mockResolvedValue({
			name: 'staff-a',
			roles: ['shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function get(query: string): Promise<Response> {
		const url = new URL(`http://localhost/api/staff/v1/printers${query}`);
		return GET({
			url,
			request: new Request(url, { headers: { cookie: 'AuthSession=staff-a' } })
		} as unknown as RequestEvent);
	}

	it('lists the active printers of the shelter with server time and no secrets', async () => {
		mockList.mockResolvedValue([
			device('b-reg', { name: 'Reg B', station: 'desk-2' }),
			device('gone', { name: 'A gone', status: 'inactive' }),
			device('a-reg', { name: 'Reg A', last_seen_at: '2026-10-22T02:50:00.000Z' })
		]);

		const response = await get('?shelter_code=SH001');

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockAuth).toHaveBeenCalledWith('AuthSession=staff-a', 'SH001');
		expect(mockList).toHaveBeenCalledWith('SH001');
		expect(await response.json()).toEqual({
			printers: [
				{
					id: 'print_device:a-reg',
					name: 'Reg A',
					station: null,
					online: false,
					queue_state: 'ready',
					last_seen_at: '2026-10-22T02:50:00.000Z'
				},
				{
					id: 'print_device:b-reg',
					name: 'Reg B',
					station: 'desk-2',
					online: true,
					queue_state: 'ready',
					last_seen_at: '2026-10-22T02:59:50.000Z'
				}
			],
			server_time: '2026-10-22T03:00:00.000Z'
		});
	});

	it('answers 422 VALIDATION without a shelter_code', async () => {
		const response = await get('');

		expect(response.status).toBe(422);
		expect((await response.json()).error.code).toBe('VALIDATION');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('answers 403 FORBIDDEN for a shelter outside the caller scope', async () => {
		mockAuth.mockImplementation(async () => error(403, 'Caller is not in shelter "SH002" scope'));

		const response = await get('?shelter_code=SH002');

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('FORBIDDEN');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('answers 401 UNAUTHENTICATED for an anonymous caller', async () => {
		mockAuth.mockImplementation(async () => error(401, 'Authentication required'));

		const response = await get('?shelter_code=SH001');

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
		expect(mockList).not.toHaveBeenCalled();
	});
});
