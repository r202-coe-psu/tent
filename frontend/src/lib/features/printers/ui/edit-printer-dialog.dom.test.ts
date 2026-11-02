// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { PrinterAdminSummary } from '../domain/print-device.schema';
import { PrintApiError } from '../data/printers.api';
import EditPrinterDialog from './edit-printer-dialog.svelte';

const updateMutateAsync = vi.fn();
const rotateMutateAsync = vi.fn();
const rotateReset = vi.fn();
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../application/queries', () => ({
	useUpdatePrinterDevice: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
	useRotatePrinterSecret: () => ({
		mutateAsync: rotateMutateAsync,
		reset: rotateReset,
		isPending: false
	}),
	useTestPrintPrinter: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeletePrinterDevice: () => ({ mutateAsync: vi.fn(), isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast }));

const kioskDevices = [
	{ device_id: 'kiosk-a', name: 'ตู้ A', shelter_code: 'SH001' },
	{ device_id: 'kiosk-c', name: 'ตู้ C', shelter_code: 'SH001' },
	{ device_id: 'kiosk-x', name: 'ตู้ ศูนย์อื่น', shelter_code: 'SH002' }
];

const printer = (over: Partial<PrinterAdminSummary> = {}): PrinterAdminSummary => ({
	id: 'print_device:printer-sh001-k',
	device_id: 'printer-sh001-k',
	name: 'ตู้ kiosk A',
	shelter_code: 'SH001',
	station: null,
	host_kind: 'kiosk',
	kiosk_device_id: 'kiosk-a',
	status: 'active',
	secret_prefix: 'sk_print_0123',
	last_seen_at: null,
	queue_state: 'unknown',
	agent_version: null,
	local_ips: [],
	online: false,
	...over
});

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}
async function open(p: PrinterAdminSummary) {
	instance = mount(EditPrinterDialog, {
		target: document.body,
		props: { open: true, printer: p, kioskDevices }
	});
	await settle();
}
const select = () => document.getElementById('edit-printer-kiosk') as HTMLSelectElement | null;
function choose(value: string) {
	const el = select() as HTMLSelectElement;
	for (const option of el.options) option.selected = option.value === value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
const save = () =>
	[...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.replace(/\s+/g, ' ').trim() === 'บันทึก'
	) as HTMLButtonElement;

beforeEach(() => {
	vi.clearAllMocks();
	updateMutateAsync.mockResolvedValue(printer());
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('EditPrinterDialog kiosk link', () => {
	it('offers only the scanners of the printer shelter, preselecting the linked one', async () => {
		await open(printer());

		expect([...(select()?.options ?? [])].map((o) => o.value)).toEqual(['', 'kiosk-a', 'kiosk-c']);
		expect(select()?.value).toBe('kiosk-a');
	});

	it('patches only kiosk_device_id when the user picks another kiosk', async () => {
		await open(printer());

		choose('kiosk-c');
		save().click();
		await settle();

		expect(updateMutateAsync).toHaveBeenCalledWith({
			deviceId: 'printer-sh001-k',
			patch: { kiosk_device_id: 'kiosk-c' }
		});
	});

	it('clears the link with null when the user picks "not linked"', async () => {
		await open(printer());

		choose('');
		save().click();
		await settle();

		expect(updateMutateAsync).toHaveBeenCalledWith({
			deviceId: 'printer-sh001-k',
			patch: { kiosk_device_id: null }
		});
	});

	it('hides the kiosk picker for a standalone printer', async () => {
		await open(printer({ host_kind: 'standalone', kiosk_device_id: null }));

		expect(select()).toBeNull();
	});

	it('explains KIOSK_DEVICE_NOT_FOUND in Thai instead of the raw server message', async () => {
		updateMutateAsync.mockRejectedValue(
			new PrintApiError('Kiosk device not found', 422, 'KIOSK_DEVICE_NOT_FOUND')
		);
		await open(printer());

		choose('kiosk-c');
		save().click();
		await settle();

		expect(toast.error).toHaveBeenCalledWith('ไม่พบตู้ kiosk นี้ในศูนย์ของเครื่องพิมพ์');
	});

	const rotateButton = (root: ParentNode = document.body) =>
		[...root.querySelectorAll('button')].find(
			(b) => b.textContent?.replace(/\s+/g, ' ').trim() === 'ออก Secret ใหม่'
		);
	const confirmDialog = () => document.body.querySelector('[role="alertdialog"]');

	async function mountWithRotate(onrotated = vi.fn()) {
		instance = mount(EditPrinterDialog, {
			target: document.body,
			props: { open: true, printer: printer(), kioskDevices, onrotated }
		});
		await settle();
		return onrotated;
	}

	it('asks for confirmation before issuing a new secret', async () => {
		await mountWithRotate();

		rotateButton()?.click();
		await settle();

		expect(rotateMutateAsync).not.toHaveBeenCalled();
		expect(confirmDialog()?.textContent).toContain('เครื่อง Pi จะออฟไลน์');
	});

	it('does not issue a secret when the confirmation is cancelled', async () => {
		await mountWithRotate();
		rotateButton()?.click();
		await settle();

		[...(confirmDialog()?.querySelectorAll('button') ?? [])]
			.find((b) => b.textContent?.trim() === 'ยกเลิก')
			?.click();
		await settle();

		expect(rotateMutateAsync).not.toHaveBeenCalled();
	});

	it('hands the rotated secret to the page and resets the mutation so it is not kept', async () => {
		const result = { device: printer(), secret: 'sk_print_new' };
		rotateMutateAsync.mockResolvedValue(result);
		const onrotated = await mountWithRotate();

		rotateButton()?.click();
		await settle();
		rotateButton(confirmDialog() ?? undefined)?.click();
		await settle();

		expect(onrotated).toHaveBeenCalledWith(result);
		expect(rotateReset).toHaveBeenCalledTimes(1);
	});
});
