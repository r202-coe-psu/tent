// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import { langState } from '$lib/states/i18n.svelte';
import EvacueeQrSearchModal from './evacuee-qr-search-modal.svelte';

const lookup = vi.hoisted(() => vi.fn());

// No camera, no CouchDB: the camera start always fails and the lookup is scripted per test.
vi.mock('html5-qrcode', () => ({
	Html5Qrcode: class {
		isScanning = false;
		start() {
			return Promise.reject(new Error('no camera'));
		}
	}
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/svelte-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/svelte-query')>()),
	useQueryClient: () => ({})
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	lookupFederatedByScanCode: lookup
}));

const EXPIRED = {
	status: 'expired',
	issued_at: '2026-11-03T02:10:00.000Z',
	current_printed_at: '2026-11-05T09:41:12.512Z'
} as const;

let instance: ReturnType<typeof mount> | null = null;
let previousLanguage = langState.current;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function openModal(language: 'th' | 'en') {
	previousLanguage = langState.current;
	langState.current = language;
	instance = mount(EvacueeQrSearchModal, {
		target: document.body,
		props: { show: true, onClose: () => {}, onFound: () => {} }
	});
	await settle();
}

async function submitCode(value: string) {
	const input = document.getElementById('qr-manual-code') as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
	input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await settle();
}

const alertText = () =>
	document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim();

beforeEach(() => {
	vi.mocked(toast.error).mockClear();
	lookup.mockReset();
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	langState.current = previousLanguage;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('EvacueeQrSearchModal', () => {
	it('shows English labels and no Thai text when the staff language is EN', async () => {
		await openModal('en');
		const body = document.body.textContent ?? '';
		expect(body).toContain('Scan ticket QR code (Digital Pass Scanner)');
		expect(body).toContain('Or enter the code with a barcode scanner / type it in:');
		expect(body).toContain('OK');
		expect(body).toContain('Cancel');
		expect(body).toContain('Cannot access the camera. Please check the camera permission.');
		expect(document.getElementById('qr-manual-code')?.getAttribute('placeholder')).toBe(
			'Scan or type the ID number / ticket code...'
		);
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', async () => {
		await openModal('th');
		const body = document.body.textContent ?? '';
		expect(body).toContain('สแกน QR Code ตั๋วผู้พักพิง (Digital Pass Scanner)');
		expect(body).toContain('หรือระบุรหัสด้วยเครื่องสแกนบาร์โค้ด / พิมพ์ด้วยมือ:');
		expect(body).toContain('ตกลง');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง');
		expect(document.getElementById('qr-manual-code')?.getAttribute('placeholder')).toBe(
			'สแกนหรือพิมพ์เลขประจำตัว / รหัสตั๋ว...'
		);
	});

	it('toasts the not-found message in English when the staff language is EN', async () => {
		lookup.mockResolvedValue(null);
		await openModal('en');
		await submitCode('ABC123');
		expect(toast.error).toHaveBeenCalledWith(
			'No evacuee found for the code "ABC123" in shelter SH001'
		);
	});

	it('toasts the not-found message in Thai when the staff language is TH', async () => {
		lookup.mockResolvedValue(null);
		await openModal('th');
		await submitCode('ABC123');
		expect(toast.error).toHaveBeenCalledWith('ไม่พบข้อมูลผู้พักพิงจากรหัส "ABC123" ในศูนย์ SH001');
	});

	it('toasts a short message and shows the full reason when a QR is refused (CR-233)', async () => {
		lookup.mockResolvedValue({
			source: 'qr_rejected',
			verdict: EXPIRED
		});
		await openModal('th');
		await submitCode('evacuee:ABC@111111');
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('สแกนไม่ผ่าน');
		expect(alertText()).toContain('มีใบใหม่วันที่');
	});

	it('toasts the refusal in English when the staff language is EN', async () => {
		lookup.mockResolvedValue({
			source: 'qr_rejected',
			verdict: EXPIRED
		});
		await openModal('en');
		await submitCode('evacuee:ABC@111111');
		expect(toast.error).toHaveBeenCalledWith('Scan rejected');
		expect(alertText()).toContain('A new one was issued on');
		expect(alertText()).toContain('try searching by name instead');
	});

	it('clears the refusal reason when the next scan starts', async () => {
		lookup.mockResolvedValueOnce({
			source: 'qr_rejected',
			verdict: EXPIRED
		});
		await openModal('th');
		await submitCode('evacuee:ABC@111111');
		expect(alertText()).toContain('มีใบใหม่วันที่');

		let release!: (v: unknown) => void;
		lookup.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
		await submitCode('evacuee:ABC@222222');
		expect(alertText()).toBeUndefined();
		release(null);
		await settle();
	});
});
