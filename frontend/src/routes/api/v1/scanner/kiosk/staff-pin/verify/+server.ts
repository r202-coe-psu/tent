import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	scannerServerRepository,
	type PersistedScannerDevice
} from '$lib/features/scanners/server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { StaffPinUnavailableError, verifyDeviceStaffPin } from '$lib/server/scanners/staff-pin';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import { staffPinSchema } from '$lib/features/scanners/domain/scanner.schema';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

const verifyBodySchema = z.object({ pin: staffPinSchema }).strict();

function respond(body: unknown, status: number): Response {
	return json(body, { status, headers: noStoreHeaders });
}

/** Audit line: device, time, outcome. Never the PIN. */
function audit(deviceId: string, outcome: string): void {
	console.info(
		`[scanner-staff-pin] verify device=${deviceId} result=${outcome} at=${new Date().toISOString()}`
	);
}

/**
 * Kiosk staff bypass: check the PIN a staff member typed on the kiosk for *this* device.
 * Authenticated with the scanner's device credentials (attached by scanner_client); the device
 * whose PIN is checked is always the authenticated one, never something from the body.
 */
export const POST: RequestHandler = async ({ request }) => {
	let device: PersistedScannerDevice | null = null;
	try {
		await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			{
				// Capture the doc authentication already loaded, so the PIN check needs no 2nd read.
				getDeviceByDeviceId: async (deviceId) => {
					device = await scannerServerRepository.getDeviceByDeviceId(deviceId);
					return device;
				}
			}
		);
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return respond(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
				401
			);
		}
		return respond(
			{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' } },
			503
		);
	}
	const authenticated = device as PersistedScannerDevice | null;
	if (!authenticated) {
		return respond(
			{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' } },
			503
		);
	}

	const body: unknown = await request.json().catch(() => null);
	const parsed = verifyBodySchema.safeParse(body);
	if (!parsed.success) {
		return respond({ error: { code: 'VALIDATION', message: 'PIN ต้องเป็นตัวเลข 6 หลัก' } }, 400);
	}

	try {
		const result = await verifyDeviceStaffPin(authenticated, parsed.data.pin);
		audit(authenticated.device_id, result.kind);
		switch (result.kind) {
			case 'ok':
				return respond({ ok: true }, 200);
			case 'wrong':
				return respond({ error: { code: 'staff_pin_invalid', message: 'PIN ไม่ถูกต้อง' } }, 401);
			case 'not_set':
				return respond(
					{
						error: {
							code: 'staff_pin_not_set',
							message: 'ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'
						}
					},
					409
				);
		}
	} catch (error) {
		audit(
			authenticated.device_id,
			error instanceof StaffPinUnavailableError ? 'unavailable' : 'error'
		);
		return respond(
			{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' } },
			503
		);
	}
};
