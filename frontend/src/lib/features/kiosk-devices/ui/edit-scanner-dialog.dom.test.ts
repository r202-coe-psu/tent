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
	banner_enabled: true
};

let instance: ReturnType<typeof mount> | null = null;
const callbacks = {
	onviewsecret: vi.fn(),
	onviewpin: vi.fn(),
	onsetpin: vi.fn(),
	ondelete: vi.fn()
};

async function render() {
	instance = mount(EditScannerDialog, {
		target: document.body,
		props: { open: true, device, ...callbacks }
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
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('EditScannerDialog', () => {
	it('keeps บันทึก disabled until something changes', async () => {
		await render();
		expect(buttonByText('บันทึก').disabled).toBe(true);

		switchByLabel('แสดงแบนเนอร์').click();
		flushSync();
		expect(buttonByText('บันทึก').disabled).toBe(false);
	});

	it('saves only the changed fields as one patch', async () => {
		await render();
		switchByLabel('แสดงแบนเนอร์').click();
		switchByLabel('เปิดใช้งานเครื่อง').click();
		flushSync();

		buttonByText('บันทึก').click();
		await settle();

		expect(mutateAsync).toHaveBeenCalledWith({
			deviceId: 'SCAN-01',
			patch: { banner_enabled: false, status: 'inactive' }
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
