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

const printer = (over: Partial<PrinterAdminSummary> = {}): PrinterAdminSummary => ({
	id: 'print_device:printer-sh001-k',
	device_id: 'printer-sh001-k',
	name: 'ตู้ kiosk A',
	shelter_code: 'SH001',
	station: null,
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
		props: { open: true, printer: p }
	});
	await settle();
}
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

describe('EditPrinterDialog', () => {
	it('tells the shelter is closed when reactivating is refused', async () => {
		updateMutateAsync.mockRejectedValue(new PrintApiError('closed', 422, 'SHELTER_CLOSED'));
		await open(printer({ status: 'inactive' }));

		document.body.querySelector<HTMLElement>('[role="switch"]')?.click();
		flushSync();
		[...document.body.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === 'บันทึก')
			?.click();
		await settle();

		expect(updateMutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({ patch: { status: 'active' } })
		);
		expect(toast.error).toHaveBeenCalledWith(
			'ไม่พบศูนย์นี้ หรือศูนย์ปิด/ถูกยกเลิกแล้ว จึงลงทะเบียนหรือเปิดใช้เครื่องพิมพ์ไม่ได้'
		);
	});

	it('has no kiosk picker', async () => {
		await open(printer());

		expect(document.getElementById('edit-printer-kiosk')).toBeNull();
	});

	const rotateButton = (root: ParentNode = document.body) =>
		[...root.querySelectorAll('button')].find(
			(b) => b.textContent?.replace(/\s+/g, ' ').trim() === 'ออก Secret ใหม่'
		);
	const confirmDialog = () => document.body.querySelector('[role="alertdialog"]');

	async function mountWithRotate(onrotated = vi.fn()) {
		instance = mount(EditPrinterDialog, {
			target: document.body,
			props: { open: true, printer: printer(), onrotated }
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
