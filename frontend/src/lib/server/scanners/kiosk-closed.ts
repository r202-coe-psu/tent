import { json } from '@sveltejs/kit';
import type { ScannerDevicePrincipal } from './device-credentials';

/** `undefined` counts as open: only an explicit `service_open: false` closes a kiosk. */
export function isKioskClosed(principal: Pick<ScannerDevicePrincipal, 'service_open'>): boolean {
	return principal.service_open === false;
}

/** 403 for an authenticated kiosk whose service is closed ("ปิดให้บริการ"). */
export function kioskClosedResponse(): Response {
	return json(
		{
			error: { code: 'KIOSK_CLOSED', message: 'ตู้นี้ปิดให้บริการชั่วคราว กรุณาติดต่อเจ้าหน้าที่' }
		},
		{ status: 403, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
	);
}
