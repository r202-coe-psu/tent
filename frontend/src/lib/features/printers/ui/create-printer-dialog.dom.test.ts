// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { PrintApiError } from '../data/printers.api';
import CreatePrinterDialog from './create-printer-dialog.svelte';

const mutateAsync = vi.fn();
const reset = vi.fn();
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../application/queries', () => ({
	useCreatePrinterDevice: () => ({ mutateAsync, reset, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast }));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}
const field = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
function fill(id: string, value: string, event: 'input' | 'change' = 'input') {
	const el = field(id);
	if (event === 'change') {
		// happy-dom keeps `:checked` (which Svelte's select binding reads) in sync with `selected`.
		for (const option of el.options) option.selected = option.value === value;
	} else {
		el.value = value;
	}
	el.dispatchEvent(new Event(event, { bubbles: true }));
	flushSync();
}
const submit = () =>
	[...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.replace(/\s+/g, ' ').trim() === 'สร้างและรับ Secret'
	) as HTMLButtonElement;

beforeEach(async () => {
	vi.clearAllMocks();
	mutateAsync.mockResolvedValue({ device: {}, secret: 'sk_print_x' });
	instance = mount(CreatePrinterDialog, {
		target: document.body,
		props: { open: true, fixedShelterCode: 'SH001', oncreated: vi.fn() }
	});
	await settle();
	fill('printer-device-id', 'printer-sh001-k');
	fill('printer-name', 'ตู้ kiosk A');
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('CreatePrinterDialog secret handling', () => {
	it('resets the mutation once the secret is handed off so it is not kept in memory', async () => {
		submit().click();
		await settle();

		expect(mutateAsync).toHaveBeenCalledTimes(1);
		expect(reset).toHaveBeenCalledTimes(1);
	});

	it('submits when Enter submits the form', async () => {
		field('printer-name').form?.requestSubmit();
		await settle();

		expect(mutateAsync).toHaveBeenCalledTimes(1);
	});
});

describe('CreatePrinterDialog validation copy', () => {
	it('tells the shelter is closed instead of calling it a taken Device ID', async () => {
		mutateAsync.mockRejectedValue(new PrintApiError('closed', 422, 'SHELTER_CLOSED'));

		submit().click();
		await settle();

		expect(toast.error).toHaveBeenCalledWith(
			'ไม่พบศูนย์นี้ หรือศูนย์ปิด/ถูกยกเลิกแล้ว จึงลงทะเบียนหรือเปิดใช้เครื่องพิมพ์ไม่ได้'
		);
	});

	it('toasts a bad Device ID in Thai, not the schema English', async () => {
		fill('printer-device-id', 'AB');

		submit().click();
		await settle();

		expect(mutateAsync).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(
			'Device ID ต้องเป็นตัวพิมพ์เล็ก ตัวเลข และ - ยาว 3–63 ตัวอักษร'
		);
	});

	it('toasts a blank name in Thai', async () => {
		fill('printer-name', '   ');

		submit().click();
		await settle();

		expect(toast.error).toHaveBeenCalledWith('กรุณากรอกชื่อเครื่อง');
	});
});

describe('CreatePrinterDialog payload', () => {
	it('sends neither a kiosk link nor an install kind', async () => {
		expect(field('printer-kiosk-device')).toBeNull();
		expect(field('printer-host-kind')).toBeNull();

		submit().click();
		await settle();

		const sent = mutateAsync.mock.calls[0][0];
		expect(sent).not.toHaveProperty('kiosk_device_id');
		expect(sent).not.toHaveProperty('host_kind');
	});
});
