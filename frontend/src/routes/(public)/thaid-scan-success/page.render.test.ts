import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('http://app.test/thaid-scan-success') }));

vi.mock('$app/state', () => ({ page: mockPage }));

const DIFFERENT_BROWSER_COPY =
	'เปิดลิงก์ในเบราว์เซอร์คนละตัวกับตอนเริ่ม กรุณาเปิดลิงก์ในเบราว์เซอร์หลักของเครื่อง (เช่น Chrome หรือ Safari) แล้วลองใหม่อีกครั้ง';

function renderAt(search: string) {
	mockPage.url = new URL(`http://app.test/thaid-scan-success${search}`);
	return render(Page, { props: {} }).body;
}

describe('thaid scan success page', () => {
	it('tells the user to reopen the link in the main browser when error=invalid_state', () => {
		expect(renderAt('?error=invalid_state')).toContain(DIFFERENT_BROWSER_COPY);
	});

	it('shows the same different-browser guidance in the kiosk flow', () => {
		expect(renderAt('?flow=kiosk&error=invalid_state')).toContain(DIFFERENT_BROWSER_COPY);
	});

	it('still tells the kiosk user to regenerate the QR when the session expired', () => {
		expect(renderAt('?flow=kiosk&error=session_expired')).toContain(
			'QR หมดอายุ กรุณาสร้าง QR ใหม่ที่ตู้'
		);
	});
});
