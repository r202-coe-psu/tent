import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import { checkInSelectedMembers } from '$lib/features/kiosk/server/kiosk-check-in.server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';

vi.mock('$lib/features/scanners/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/scanners/server')>(
		'$lib/features/scanners/server'
	);
	return {
		...actual,
		scannerServerRepository: { updateDeviceLastSeen: vi.fn() }
	};
});

vi.mock('$lib/features/kiosk/server/kiosk-check-in.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/kiosk/server/kiosk-check-in.server')
	>('$lib/features/kiosk/server/kiosk-check-in.server');
	return { ...actual, checkInSelectedMembers: vi.fn() };
});

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockCheckIn = vi.mocked(checkInSelectedMembers);
const mockHeartbeat = vi.mocked(scannerServerRepository.updateDeviceLastSeen);
const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const memberId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAW';
const principal = { registry_id: 'device-record-1', shelter_code: 'SH001' };

function request(body: unknown, deviceId = 'test-kiosk-device'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/check-in', {
			method: 'POST',
			headers: {
				...(deviceId ? { 'x-device-id': deviceId } : {}),
				'x-device-secret': 'test-secret',
				'content-type': 'application/json'
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

async function send(body: unknown, deviceId?: string): Promise<Response> {
	return POST(request(body, deviceId));
}

describe('POST /api/v1/scanner/kiosk/check-in', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return principal as never;
		});
		mockCheckIn.mockResolvedValue([
			{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }
		] as never);
		mockHeartbeat.mockResolvedValue(undefined);
	});

	it('authenticates the device, checks in members, and returns no-store results', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId, memberId]
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toMatchObject({
			shelter_code: 'SH001',
			members: [{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }]
		});
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId, memberId]);
		expect(mockHeartbeat).toHaveBeenCalledWith('device-record-1');
	});

	it('rejects more than twenty IDs before writing', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: Array.from({ length: 21 }, () => primaryId)
		});
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('INVALID_CHECK_IN_INPUT');
		expect(mockCheckIn).not.toHaveBeenCalled();
	});

	it('maps device authentication failures to 401', async () => {
		const response = await POST(
			request({ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] }, '')
		);
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe(DEVICE_AUTH_FAILED);
	});

	it('maps credential-service outages to 503', async () => {
		mockAuthenticate.mockRejectedValueOnce(new ScannerDependencyError());
		const response = await send({ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] });
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe(DEPENDENCY_UNAVAILABLE);
	});

	it('maps unexpected write failures to a no-store 500', async () => {
		mockCheckIn.mockRejectedValueOnce(new Error('database unavailable'));
		const response = await send({ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] });
		expect(response.status).toBe(500);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('KIOSK_CHECK_IN_FAILED');
	});
});
