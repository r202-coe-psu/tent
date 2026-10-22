import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import { hashPrintSecret, type PrintDeviceDoc } from '$lib/server/printers/device-credentials';
import { printDeviceRepository } from '$lib/server/printers/printer-server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { getDevice: vi.fn(), updateDevice: vi.fn() }
}));

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(printDeviceRepository.getDevice);
const mockUpdate = vi.mocked(printDeviceRepository.updateDevice);

const OLD_SECRET = 'sk_print_' + '1'.repeat(64);
const device: PrintDeviceDoc = {
	_id: 'print_device:printer-sh001-reg1',
	_rev: '3-c',
	type: 'print_device',
	schema_v: 1,
	device_id: 'printer-sh001-reg1',
	name: 'จุดลงทะเบียน 1',
	shelter_code: 'SH001',
	station: null,
	host_kind: 'standalone',
	secret_hash: hashPrintSecret(OLD_SECRET),
	secret_prefix: OLD_SECRET.slice(0, 16),
	status: 'active',
	last_seen_at: '2026-10-22T02:59:50.000Z',
	queue_state: 'ready',
	agent_version: '0.1.0',
	created_at: '2026-10-22T00:00:00.000Z',
	updated_at: '2026-10-22T02:59:50.000Z',
	created_by: 'sa-user'
};

beforeEach(() => {
	vi.clearAllMocks();
	mockSession.mockResolvedValue(SESSIONS.admin);
	mockGet.mockResolvedValue(device);
	mockUpdate.mockResolvedValue({ ok: true, rev: '4-d' });
});

async function post(id: string): Promise<Response> {
	return POST({
		params: { id },
		request: new Request(`http://localhost/api/back-office/printers/${id}/rotate-secret`, {
			method: 'POST',
			headers: { cookie: 'AuthSession=sa' }
		})
	} as unknown as RequestEvent);
}

describe('POST /api/back-office/printers/[id]/rotate-secret', () => {
	it('returns the new secret once and stores only its hash', async () => {
		const response = await post('printer-sh001-reg1');

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const data = await response.json();
		expect(data.secret).toMatch(/^sk_print_[0-9a-f]{64}$/);
		expect(data.secret).not.toBe(OLD_SECRET);
		expect(data.device).toMatchObject({
			id: 'print_device:printer-sh001-reg1',
			secret_prefix: data.secret.slice(0, 16)
		});
		expect(data.device).not.toHaveProperty('secret_hash');
		const written = mockUpdate.mock.calls[0][0];
		expect(written.secret_hash).toBe(hashPrintSecret(data.secret));
		expect(JSON.stringify(written)).not.toContain(data.secret);
	});

	it('answers 404 for an unknown printer and for one outside the manager scope, rotating nothing', async () => {
		mockGet.mockResolvedValue(null);
		expect((await post('printer-nope')).status).toBe(404);

		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue({ ...device, shelter_code: 'SH002' });
		expect((await post('printer-sh001-reg1')).status).toBe(404);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('answers 401 for anonymous and 403 for registration staff', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		expect((await post('printer-sh001-reg1')).status).toBe(401);
		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await post('printer-sh001-reg1')).status).toBe(403);
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});
