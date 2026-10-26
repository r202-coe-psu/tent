// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import KioskDeviceInfo from './kiosk-device-info.svelte';

// Canvas / QR image rendering has no happy-dom implementation: stub the image makers only.
vi.mock('../application/kiosk-label-image', () => ({
	renderKioskLabelPng: vi.fn(async () => 'PNG-BASE64')
}));
vi.mock('$lib/utils/qrcode', () => ({
	qrModuleCount: vi.fn(async () => 21),
	generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,QR')
}));

const DEVICE_INFO_BODY = {
	device: {
		device_id: 'kiosk-01',
		name: 'Kiosk หน้าประตู',
		station_name: 'ลงทะเบียน',
		screen_type: 'portrait'
	},
	shelter: { code: 'SH-1', name: 'ศูนย์พักพิง A' },
	staff_pin: { set: true, is_default: false, updated_at: null, updated_by: null },
	banner_group: null
};

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let instance: ReturnType<typeof mount> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const button = (label: string) =>
	document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonByText = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === text
	);
const printCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/v1/kiosk/print');

async function settle() {
	await vi.waitFor(() => flushSync());
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

async function openPanelWithPin() {
	button('ข้อมูลเครื่อง')!.click();
	flushSync();
	for (const digit of '123456') {
		// A keyboard types anywhere (the keys debounce touch taps by 80 ms).
		window.dispatchEvent(new KeyboardEvent('keydown', { key: digit, cancelable: true }));
		flushSync();
	}
	buttonByText('ยืนยัน')!.click();
	await vi.waitFor(() => expect(byTestId('kiosk-device-info-panel')).not.toBeNull());
}

beforeEach(() => {
	fetchMock = vi.fn(async (url: string) => {
		if (url === '/api/v1/kiosk/device-info') return json(200, DEVICE_INFO_BODY);
		if (url === '/api/v1/kiosk/host-info') return json(200, { hostname: 'kiosk-01', ips: [] });
		if (url === '/api/v1/kiosk/print') return json(200, { printed: 1 });
		return json(404, {});
	});
	vi.stubGlobal('fetch', fetchMock);
	// happy-dom has no Web Animations API; Svelte transitions need it. Finish them at once.
	Element.prototype.animate = function () {
		const animation = {
			onfinish: null as (() => void) | null,
			cancel() {},
			finish() {},
			currentTime: 0
		};
		queueMicrotask(() => animation.onfinish?.());
		return animation as unknown as Animation;
	};
	instance = mount(KioskDeviceInfo, { target: document.body });
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('KioskDeviceInfo test print (DOM)', () => {
	it('prints one sample label straight from the panel, without asking for the PIN again', async () => {
		await openPanelWithPin();

		byTestId('kiosk-device-info-test-print')!.click();
		await vi.waitFor(() => expect(printCalls()).toHaveLength(1));
		await settle();

		const [, init] = printCalls()[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({ labels: ['PNG-BASE64'] });
		expect(byTestId('kiosk-device-info-pin')).toBeNull();
		expect(byTestId('kiosk-staff-pin')).toBeNull();
		expect(byTestId('kiosk-device-info-panel')).not.toBeNull();
	});
});

describe('KioskDeviceInfo screen row (DOM)', () => {
	it('names the screen size set for this kiosk in Thai instead of the raw value', async () => {
		await openPanelWithPin();

		expect(byTestId('kiosk-device-info-screen')?.textContent?.trim()).toBe('ตู้ใหญ่ · 1080×1920');
	});
});

describe('KioskDeviceInfo staff PIN row (DOM)', () => {
	const pinValue = () => byTestId('kiosk-device-info-pin-value')?.textContent?.trim();

	it('shows the PIN masked, reveals it with the eye toggle, and starts masked again when reopened', async () => {
		await openPanelWithPin();

		expect(pinValue()).toBe('••••••');
		expect(button('แสดง PIN')!.getAttribute('aria-pressed')).toBe('false');

		button('แสดง PIN')!.click();
		flushSync();
		expect(pinValue()).toBe('123456');
		expect(button('ซ่อน PIN')!.getAttribute('aria-pressed')).toBe('true');

		button('ซ่อน PIN')!.click();
		flushSync();
		expect(pinValue()).toBe('••••••');

		button('แสดง PIN')!.click();
		flushSync();
		buttonByText('ปิด')!.click();
		await vi.waitFor(() => expect(byTestId('kiosk-device-info-panel')).toBeNull());

		await openPanelWithPin();
		expect(pinValue()).toBe('••••••');
	});
});

describe('KioskDeviceInfo panel focus (DOM)', () => {
	it('moves keyboard focus onto the close button when the panel opens after the PIN', async () => {
		await openPanelWithPin();

		expect(document.activeElement).toBe(buttonByText('ปิด'));
	});

	const pressTab = (shiftKey = false) => {
		const event = new KeyboardEvent('keydown', {
			key: 'Tab',
			shiftKey,
			bubbles: true,
			cancelable: true
		});
		(document.activeElement ?? document.body).dispatchEvent(event);
		flushSync();
	};

	it('wraps Tab from the last control to the first, and Shift+Tab from the first to the last', async () => {
		await openPanelWithPin();
		expect(document.activeElement).toBe(buttonByText('ปิด'));

		pressTab();
		expect(document.activeElement).toBe(button('แสดง PIN'));

		pressTab(true);
		expect(document.activeElement).toBe(buttonByText('ปิด'));
	});

	it('returns focus to the device-info button when the panel closes', async () => {
		await openPanelWithPin();

		buttonByText('ปิด')!.click();
		await vi.waitFor(() => expect(byTestId('kiosk-device-info-panel')).toBeNull());

		await vi.waitFor(() => expect(document.activeElement).toBe(button('ข้อมูลเครื่อง')));
	});

	it('also returns focus to the device-info button when Esc closes the panel', async () => {
		await openPanelWithPin();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await vi.waitFor(() => expect(byTestId('kiosk-device-info-panel')).toBeNull());

		await vi.waitFor(() => expect(document.activeElement).toBe(button('ข้อมูลเครื่อง')));
	});
});
