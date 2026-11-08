// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const resolveScannedRecipient = vi.hoisted(() => vi.fn());
vi.mock('svelte-sonner', () => ({ toast }));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('$lib/features/people', () => ({
	useSearchEvacuees: () => ({ data: [], isPending: false }),
	lookupEvacueeByScanCode: vi.fn(),
	readEvacueeQrPrints: vi.fn()
}));
vi.mock('$lib/features/volunteers', () => ({
	lookupVolunteerByScanCode: vi.fn(),
	useVolunteers: () => ({ data: [], isPending: false, isError: false })
}));
vi.mock('$lib/features/users', () => ({ resolveStaffCard: vi.fn() }));
vi.mock('$lib/components/camera-code-scanner.svelte', () => ({ default: () => {} }));
vi.mock('../model/recipient-scan', async (importOriginal) => ({
	...(await importOriginal<typeof import('../model/recipient-scan')>()),
	resolveScannedRecipient
}));

import RecipientSearchPicker from './RecipientSearchPicker.svelte';

const REJECTED = 'QR นี้ออกวันที่ 8 พ.ย. 2569 13:52 มีใบใหม่ — ลองค้นหาด้วยชื่อแทน';

let instance: ReturnType<typeof mount> | null = null;

async function scanTyped(code: string) {
	const button = [...document.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('สแกน QR ผู้รับ')
	)!;
	button.click();
	await tick();
	flushSync();
	const input = document.getElementById('camera-code-manual') as HTMLInputElement;
	input.value = code;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await vi.waitFor(() => flushSync());
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

const modalAlert = () => document.querySelector('[role="dialog"] [role="alert"]');

beforeEach(() => {
	toast.error.mockReset();
	resolveScannedRecipient.mockReset();
	instance = mount(RecipientSearchPicker, { target: document.body, props: {} });
	flushSync();
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('RecipientSearchPicker refused scan', () => {
	it('toasts a short message and keeps the full reason inside the scan modal', async () => {
		resolveScannedRecipient.mockResolvedValue({ kind: 'error', message: REJECTED });

		await scanTyped('evacuee:ABC@111111');

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('สแกนไม่ผ่าน');
		expect(modalAlert()?.textContent?.trim()).toBe(REJECTED);
	});

	it('toasts the same short message when the lookup itself fails', async () => {
		resolveScannedRecipient.mockRejectedValue(new Error('offline'));

		await scanTyped('evacuee:ABC@111111');

		expect(toast.error).toHaveBeenCalledWith('สแกนไม่ผ่าน');
		expect(modalAlert()).not.toBeNull();
	});
});
