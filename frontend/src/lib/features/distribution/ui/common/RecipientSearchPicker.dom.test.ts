// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FrontlineRecipientSelection } from '../model/frontline-handover';
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

let onselect: Mock<(recipient: FrontlineRecipientSelection | null) => void>;
function mountPicker(props: Record<string, unknown> = {}) {
	if (instance) unmount(instance);
	onselect = vi.fn<(recipient: FrontlineRecipientSelection | null) => void>();
	instance = mount(RecipientSearchPicker, { target: document.body, props: { onselect, ...props } });
	flushSync();
}

beforeEach(() => {
	toast.error.mockReset();
	resolveScannedRecipient.mockReset();
	mountPicker();
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	await new Promise((resolve) => setTimeout(resolve, 50));
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

describe('RecipientSearchPicker expired QR override (CR-233 A1)', () => {
	const EXPIRED = {
		kind: 'error',
		expiredQr: true,
		message: 'QR นี้ออกวันที่ 8 พ.ย. 2569 13:52 มีใบใหม่ — ลองค้นหาด้วยชื่อแทน'
	};
	const evacuee = {
		_id: 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0',
		first_name: 'สุนิตา',
		last_name: 'บางค้างพลู',
		household_id: 'household:test-1'
	};
	const QR_OVERRIDE = {
		issued_at: '2026-11-08T06:52:00.000Z',
		current_printed_at: '2026-11-08T06:53:00.000Z',
		overridden_at: '2026-11-08T07:00:00.000Z'
	};
	const acceptButton = () =>
		[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) =>
			b.textContent?.includes('ยอมรับความเสี่ยงเพื่อแจกจ่าย')
		);
	const settle = async () => {
		await vi.waitFor(() => flushSync());
		await new Promise((resolve) => setTimeout(resolve, 20));
		flushSync();
	};

	it('offers no accept button unless the host allows the override', async () => {
		resolveScannedRecipient.mockResolvedValue(EXPIRED);

		await scanTyped('evacuee:ABC@111111');

		expect(acceptButton()).toBeUndefined();
	});

	it('shows the button for an expired QR and selects nobody before it is pressed', async () => {
		mountPicker({ allowExpiredQrOverride: true });
		resolveScannedRecipient.mockResolvedValue(EXPIRED);

		await scanTyped('evacuee:ABC@111111');

		expect(acceptButton()).toBeDefined();
		expect(onselect).not.toHaveBeenCalled();
	});

	it('rescans with acceptExpiredQr, selects the evacuee with the audit dates and closes the modal', async () => {
		mountPicker({ allowExpiredQrOverride: true });
		resolveScannedRecipient.mockResolvedValueOnce(EXPIRED);
		await scanTyped('evacuee:ABC@111111');
		resolveScannedRecipient.mockResolvedValueOnce({
			kind: 'evacuee',
			evacuee,
			qrOverride: QR_OVERRIDE
		});

		acceptButton()!.click();
		await settle();

		expect(resolveScannedRecipient).toHaveBeenLastCalledWith(
			'evacuee:ABC@111111',
			expect.objectContaining({ acceptExpiredQr: true }),
			expect.anything()
		);
		expect(onselect).toHaveBeenCalledWith(
			expect.objectContaining({
				recipientType: 'evacuee',
				recipientId: evacuee._id,
				qrOverride: QR_OVERRIDE
			})
		);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it('never offers the button for an invalid QR', async () => {
		mountPicker({ allowExpiredQrOverride: true });
		resolveScannedRecipient.mockResolvedValue({ kind: 'error', message: 'QR ไม่ถูกต้อง' });

		await scanTyped('evacuee:ABC@ffffff');

		expect(acceptButton()).toBeUndefined();
	});
});
