// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ScannerDevice } from '../domain/scanner.schema';
import EditScannerDialog from './edit-scanner-dialog.svelte';

const mutateAsync = vi.fn();
vi.mock('../application/queries', () => ({
	useUpdateScannerDevice: () => ({ mutateAsync, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const device: ScannerDevice = {
	id: 'scanner:SCAN-01',
	device_id: 'SCAN-01',
	name: 'ตู้ประตู 1',
	shelter_code: 'SH001',
	station_name: 'จุดคัดกรองหลัก',
	status: 'active',
	last_seen_at: null,
	staff_pin_set: true,
	staff_pin_is_default: false,
	banner_group_id: null,
	screen_type: 'compact'
};

let instance: ReturnType<typeof mount> | null = null;
const callbacks = {
	onviewsecret: vi.fn(),
	onviewpin: vi.fn(),
	onsetpin: vi.fn(),
	ondelete: vi.fn()
};

async function render(groupName?: string | null, over: Partial<ScannerDevice> = {}) {
	instance = mount(EditScannerDialog, {
		target: document.body,
		props: { open: true, device: { ...device, ...over }, groupName, ...callbacks }
	});
	flushSync();
	await tick();
	flushSync();
}

const buttonByText = (text: string) =>
	[...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.replace(/\s+/g, ' ').trim() === text
	) as HTMLButtonElement;
const switchByLabel = (label: string) => {
	const id = [...document.body.querySelectorAll('label')]
		.find((l) => l.textContent?.trim() === label)
		?.getAttribute('for');
	return document.getElementById(id ?? '') as HTMLButtonElement;
};

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
	mutateAsync.mockResolvedValue(device);
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('EditScannerDialog', () => {
	it('keeps บันทึก disabled until something changes', async () => {
		await render();
		expect(buttonByText('บันทึก').disabled).toBe(true);

		switchByLabel('เปิดใช้งานเครื่อง').click();
		flushSync();
		expect(buttonByText('บันทึก').disabled).toBe(false);
	});

	it('saves only the changed fields as one patch', async () => {
		await render();
		switchByLabel('เปิดใช้งานเครื่อง').click();
		flushSync();

		buttonByText('บันทึก').click();
		await settle();

		expect(mutateAsync).toHaveBeenCalledWith({
			deviceId: 'SCAN-01',
			patch: { status: 'inactive' }
		});
	});

	it('shows the banner group as a read-only row with a link to the banner page', async () => {
		await render('ล็อบบี้', { banner_group_id: 'kiosk_banner_group:lobby' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('กลุ่มแบนเนอร์');
		expect(text).toContain('ล็อบบี้');
		expect(text).not.toContain('ไม่มีกลุ่ม');
		expect(switchByLabel('แสดงแบนเนอร์')).toBeNull();
		const link = document.body.querySelector('a[href$="/back-office/kiosks/banners"]');
		expect(link).not.toBeNull();
	});

	it('says the kiosk shows no banners when it has no group', async () => {
		await render(null);
		expect(document.body.textContent).toContain('ไม่มีกลุ่ม — เครื่องนี้ไม่แสดงแบนเนอร์');
	});

	it('shows the stored screen and saves a switch to ตู้ใหญ่ as a screen_type patch', async () => {
		await render();
		const radio = (type: string) =>
			document.body.querySelector(`[role="radio"][data-value="${type}"]`) as HTMLButtonElement;
		expect(radio('compact').getAttribute('aria-checked')).toBe('true');
		expect(radio('portrait').getAttribute('aria-checked')).toBe('false');

		radio('portrait').click();
		flushSync();
		buttonByText('บันทึก').click();
		await settle();

		expect(mutateAsync).toHaveBeenCalledWith({
			deviceId: 'SCAN-01',
			patch: { screen_type: 'portrait' }
		});
	});

	it('hands Scanner Key, PIN and delete off to their own dialogs', async () => {
		await render();
		buttonByText('ดูข้อมูลการติดตั้ง').click();
		expect(callbacks.onviewsecret).toHaveBeenCalledWith(device);

		unmount(instance as ReturnType<typeof mount>);
		await render();
		buttonByText('ลบเครื่อง').click();
		expect(callbacks.ondelete).toHaveBeenCalledWith(device);
	});
});
