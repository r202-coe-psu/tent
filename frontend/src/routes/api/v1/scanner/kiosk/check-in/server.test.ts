import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	checkInSelectedMembers,
	saveKioskCheckInCardPhoto
} from '$lib/features/kiosk/server/kiosk-check-in.server';
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
	return { ...actual, checkInSelectedMembers: vi.fn(), saveKioskCheckInCardPhoto: vi.fn() };
});

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockCheckIn = vi.mocked(checkInSelectedMembers);
const mockSavePhoto = vi.mocked(saveKioskCheckInCardPhoto);
const mockHeartbeat = vi.mocked(scannerServerRepository.updateDeviceLastSeen);
const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const memberId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAW';
const principal = {
	registry_id: 'device-record-1',
	device_id: 'test-kiosk-device',
	shelter_code: 'SH001'
};
const citizenId = '1234567890123';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const photo = {
	content_type: 'image/jpeg',
	full_base64: jpeg.toString('base64'),
	width: 1,
	height: 1,
	original_size: jpeg.length,
	compressed_size: jpeg.length,
	thumbnail_size: 0
};

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
		mockSavePhoto.mockResolvedValue('saved');
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

	it('stores the chip photo for a smart-card check-in after the members are written', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId,
			photo
		});
		expect(response.status).toBe(200);
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId]);
		expect(mockSavePhoto).toHaveBeenCalledWith('SH001', 'test-kiosk-device', {
			primaryEvacueeId: primaryId,
			citizenId,
			photo,
			results: [{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }]
		});
	});

	it('does not attempt a photo save when no photo is sent', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId
		});
		expect(response.status).toBe(200);
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});

	it('keeps the check-in successful when the photo save fails', async () => {
		mockSavePhoto.mockResolvedValueOnce('failed');
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId,
			photo
		});
		expect(response.status).toBe(200);
		expect((await response.json()).members[0].status).toBe('checked_in');
	});

	it.each([
		['bad base64', { ...photo, full_base64: 'not base64!' }],
		['unknown content type', { ...photo, content_type: 'image/png' }],
		['extra field', { ...photo, exif: 'x' }],
		['not an object', 'photo']
	])('drops an invalid photo (%s) and still checks in', async (_label, badPhoto) => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId,
			photo: badPhoto
		});
		expect(response.status).toBe(200);
		expect((await response.json()).members[0].status).toBe('checked_in');
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId]);
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});

	it('drops an invalid photo on a QR check-in instead of rejecting it', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'qr',
			photo: { content_type: 'image/png' }
		});
		expect(response.status).toBe(200);
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});

	it.each([
		['qr', { source: 'qr' }],
		['phone', { source: 'phone' }],
		['missing source', {}],
		['smart-card without citizen_id', { source: 'smart-card' }]
	])('rejects a photo on a %s check-in with 400 before writing', async (_label, extra) => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			...extra,
			photo
		});
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('INVALID_CHECK_IN_INPUT');
		expect(mockCheckIn).not.toHaveBeenCalled();
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});
});
