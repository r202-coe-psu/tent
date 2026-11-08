// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const lookup = vi.hoisted(() => vi.fn());
vi.mock('svelte-sonner', () => ({ toast }));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('html5-qrcode', () => ({
	Html5Qrcode: class {
		isScanning = false;
		start() {
			return new Promise(() => {});
		}
	}
}));
vi.mock('$lib/features/people', () => ({ lookupFederatedByScanCode: lookup }));
vi.mock('$lib/features/unassigned-registration', () => ({ ClaimDialog: () => {} }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));

import EvacueeQrSearchModal from './evacuee-qr-search-modal.svelte';

const REJECTED = 'QR นี้ออกวันที่ 8 พ.ย. 2569 13:49 มีใบใหม่ — ลองค้นหาด้วยชื่อแทน';

let instance: ReturnType<typeof mount> | null = null;
let props: { show: boolean; onClose: () => void; onFound: (id: string) => void };

async function submitCode(code: string) {
	const input = document.getElementById('qr-manual-code') as HTMLInputElement;
	input.value = code;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

const alertText = () =>
	document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim();

beforeEach(() => {
	toast.error.mockReset();
	lookup.mockReset();
	props = { show: true, onClose: vi.fn(), onFound: vi.fn() };
	instance = mount(EvacueeQrSearchModal, { target: document.body, props });
	flushSync();
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('EvacueeQrSearchModal refused QR', () => {
	it('toasts a short message and shows the full reason in the modal', async () => {
		lookup.mockResolvedValue({
			source: 'qr_rejected',
			verdict: { status: 'invalid' },
			message: REJECTED
		});

		await submitCode('evacuee:ABC@111111');

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('สแกนไม่ผ่าน');
		expect(alertText()).toBe(REJECTED);
		expect(props.onFound).not.toHaveBeenCalled();
	});

	it('clears the reason when the next scan starts', async () => {
		lookup.mockResolvedValueOnce({
			source: 'qr_rejected',
			verdict: { status: 'invalid' },
			message: REJECTED
		});
		await submitCode('evacuee:ABC@111111');
		expect(alertText()).toBe(REJECTED);

		let release!: (v: unknown) => void;
		lookup.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
		await submitCode('evacuee:ABC@222222');
		expect(alertText()).toBeUndefined();

		release(null);
		await tick();
	});
});
