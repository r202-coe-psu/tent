import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('http://app.test/thaid-scan-success') }));

vi.mock('$app/state', () => ({ page: mockPage }));

const INVALID_STATE_KIOSK_COPY =
	'ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่ที่ตู้';
const INVALID_STATE_MEMBER_SCAN_COPY =
	'ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่จากหน้าจอลงทะเบียน';

function renderAt(search: string) {
	mockPage.url = new URL(`http://app.test/thaid-scan-success${search}`);
	return render(Page, { props: {} }).body;
}

describe('thaid scan success page', () => {
	it('asks the member to rescan the registration screen QR when error=invalid_state', () => {
		expect(renderAt('?error=invalid_state')).toContain(INVALID_STATE_MEMBER_SCAN_COPY);
	});

	it('asks the kiosk user to rescan the QR at the kiosk when error=invalid_state', () => {
		expect(renderAt('?flow=kiosk&error=invalid_state')).toContain(INVALID_STATE_KIOSK_COPY);
	});

	it('still tells the kiosk user to regenerate the QR when the session expired', () => {
		expect(renderAt('?flow=kiosk&error=session_expired')).toContain(
			'QR หมดอายุ กรุณาสร้าง QR ใหม่ที่ตู้'
		);
	});
});
