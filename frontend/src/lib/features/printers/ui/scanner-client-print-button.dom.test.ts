// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { ScannerClientPrintError } from '../data/scanner-client-print.api';
import { ReportedRenderError } from '../domain/reported-error';
import Harness from './__fixtures__/scanner-client-print-button-harness.svelte';

const api = vi.hoisted(() => ({
	findScannerClientPrinter: vi.fn(),
	printOnScannerClient: vi.fn()
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const STAFF = ['shelter:SH001', 'SH001:registration_staff'];
const session = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'staff', roles: session.roles };
		}
	}
}));
vi.mock('../data/scanner-client-print.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/scanner-client-print.api')>()),
	...api
}));
vi.mock('svelte-sonner', () => ({ toast }));

let instance: ReturnType<typeof mount> | null = null;

/** Let the printer query and a click's async work resolve, and the DOM catch up. */
async function settle() {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
	}
}

async function render(props: Record<string, unknown> = {}) {
	instance = mount(Harness, {
		target: document.body,
		props: {
			client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
			shelterCode: 'SH001',
			labelCount: 1,
			source: 'evacuee_qr',
			renderLabels: async () => ['PNG1'],
			...props
		}
	});
	await settle();
}

const button = () => document.querySelector('button');

beforeEach(() => {
	session.roles = STAFF;
	api.findScannerClientPrinter.mockResolvedValue({ name: 'XP-365B' });
	api.printOnScannerClient.mockResolvedValue(1);
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('ScannerClientPrintButton', () => {
	it('shows only inside the scanner client with a printer on this PC', async () => {
		api.findScannerClientPrinter.mockResolvedValue(null);

		await render();

		expect(button()).toBeNull();
	});

	it('is hidden for staff who may not print here, without asking the scanner client', async () => {
		session.roles = ['shelter:SH002', 'SH002:registration_staff'];

		await render();

		expect(button()).toBeNull();
		expect(api.findScannerClientPrinter).not.toHaveBeenCalled();
	});

	it('names the printer, and the family size for a family', async () => {
		await render();
		expect(button()?.textContent).toContain('พิมพ์ที่เครื่องนี้ (XP-365B)');
		unmount(instance!);
		instance = null;

		await render({ labelCount: 3 });
		expect(button()?.textContent).toContain('พิมพ์ทั้งครอบครัวที่เครื่องนี้ (3 ใบ)');
	});

	it('renders the labels on click and prints them on this PC', async () => {
		const renderLabels = vi.fn(async () => ['A', 'B']);
		api.printOnScannerClient.mockResolvedValue(2);
		await render({ renderLabels, labelCount: 2 });

		button()!.click();
		await settle();

		expect(renderLabels).toHaveBeenCalledOnce();
		expect(api.printOnScannerClient).toHaveBeenCalledWith(['A', 'B']);
		expect(toast.success).toHaveBeenCalledWith('พิมพ์ 2 ใบที่ XP-365B');
		expect(document.querySelector('[data-testid="printing"]')?.textContent).toBe('false');
	});

	it('blocks a second click while printing', async () => {
		let finish: (count: number) => void = () => {};
		api.printOnScannerClient.mockImplementation(
			() => new Promise<number>((resolve) => (finish = resolve))
		);
		await render();

		button()!.click();
		await settle();
		expect(button()!.disabled).toBe(true);
		expect(document.querySelector('[data-testid="printing"]')?.textContent).toBe('true');
		button()!.click();
		finish(1);
		await settle();

		expect(api.printOnScannerClient).toHaveBeenCalledOnce();
		expect(button()!.disabled).toBe(false);
	});

	it('says what failed and how many already printed', async () => {
		api.printOnScannerClient.mockRejectedValue(new ScannerClientPrintError('PRINT_FAILED', 1));
		await render({ labelCount: 2, renderLabels: async () => ['A', 'B'] });

		button()!.click();
		await settle();

		expect(toast.error).toHaveBeenCalledWith(
			'ส่งงานพิมพ์ไปที่ XP-365B ไม่สำเร็จ ตรวจสอบสาย กระดาษ และไฟของเครื่องพิมพ์ (พิมพ์ไปแล้ว 1 ใบ)'
		);
	});

	it('prints nothing when the labels could not be made (QR not issued)', async () => {
		await render({
			renderLabels: async () => {
				throw new ReportedRenderError('QR was not issued');
			}
		});

		button()!.click();
		await settle();

		expect(api.printOnScannerClient).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled(); // the host already said why
	});

	it('reports an unexpected render failure itself', async () => {
		await render({
			renderLabels: async () => {
				throw new Error('canvas');
			}
		});

		button()!.click();
		await settle();

		expect(api.printOnScannerClient).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('สร้างภาพฉลากไม่สำเร็จ');
	});

	it('stays disabled while the host says so', async () => {
		await render({ disabled: true });

		expect(button()!.disabled).toBe(true);
	});
});
