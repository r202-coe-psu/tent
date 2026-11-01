// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { PrintApiError } from '../data/printers.api';
import CreatePrinterDialog from './create-printer-dialog.svelte';

const mutateAsync = vi.fn();
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../application/queries', () => ({
	useCreatePrinterDevice: () => ({ mutateAsync, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast }));

const kioskDevices = [
	{ device_id: 'kiosk-a', name: 'ตู้ A', shelter_code: 'SH001' },
	{ device_id: 'kiosk-x', name: 'ตู้ ศูนย์อื่น', shelter_code: 'SH002' }
];

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
		props: { open: true, fixedShelterCode: 'SH001', kioskDevices, oncreated: vi.fn() }
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

describe('CreatePrinterDialog kiosk link', () => {
	it('shows the kiosk picker only for a kiosk host, listing this shelter scanners', async () => {
		expect(field('printer-kiosk-device')).toBeNull();

		fill('printer-host-kind', 'kiosk', 'change');
		await settle();

		expect([...field('printer-kiosk-device').options].map((o) => o.value)).toEqual(['', 'kiosk-a']);
	});

	it('sends the chosen scanner as kiosk_device_id for a kiosk printer', async () => {
		fill('printer-host-kind', 'kiosk', 'change');
		await settle();
		fill('printer-kiosk-device', 'kiosk-a', 'change');

		submit().click();
		await settle();

		expect(mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({ host_kind: 'kiosk', kiosk_device_id: 'kiosk-a' })
		);
	});

	it('creates a kiosk printer without a link when none is chosen', async () => {
		fill('printer-host-kind', 'kiosk', 'change');
		await settle();

		submit().click();
		await settle();

		const sent = mutateAsync.mock.calls[0][0];
		expect(sent.host_kind).toBe('kiosk');
		expect(sent.kiosk_device_id ?? null).toBeNull();
	});

	it('drops the link when the host is switched back to standalone', async () => {
		fill('printer-host-kind', 'kiosk', 'change');
		await settle();
		fill('printer-kiosk-device', 'kiosk-a', 'change');
		fill('printer-host-kind', 'standalone', 'change');
		await settle();

		submit().click();
		await settle();

		const sent = mutateAsync.mock.calls[0][0];
		expect(sent.host_kind).toBe('standalone');
		expect(sent.kiosk_device_id ?? null).toBeNull();
	});

	it('explains KIOSK_DEVICE_REQUIRES_KIOSK_HOST in Thai', async () => {
		mutateAsync.mockRejectedValue(new PrintApiError('x', 422, 'KIOSK_DEVICE_REQUIRES_KIOSK_HOST'));

		submit().click();
		await settle();

		expect(toast.error).toHaveBeenCalledWith('เลือกตู้ kiosk ได้เฉพาะเครื่องที่ติดตั้งในตู้ kiosk');
	});
});
