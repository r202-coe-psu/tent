// @vitest-environment happy-dom
// The modal with the real PrintLabelsButton (the other modal tests stub it): the lock it binds
// must hold the modal open while a sent job may still print, and let it close once that job's
// printer leaves the list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import type { Evacuee } from '$lib/features/people';
import { PrintApiError, stationPrinter } from '$lib/features/printers';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import Harness from './__fixtures__/evacuee-qr-modal-harness.svelte';

const api = vi.hoisted(() => ({
	listShelterPrinters: vi.fn(),
	createPrintJob: vi.fn(),
	getPrintJobStatus: vi.fn()
}));
const issueQrs = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'staff', roles: ['shelter:SH001', 'SH001:registration_staff'] };
		}
	}
}));
vi.mock('$lib/features/printers/data/printers.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/printers/data/printers.api')>()),
	...api
}));
vi.mock('svelte-sonner', () => ({ toast }));
vi.mock('$lib/features/people/data/evacuee-qr.api', () => ({
	issueEvacueeQrs: issueQrs
}));
vi.mock('$lib/features/kiosk', () => ({
	KIOSK_LABEL_MM: { width: 80, height: 60 },
	renderKioskQrLabelPng: async () => 'AAAA'
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: undefined })
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useScreeningsByEvacuee: () => ({ data: [] })
}));

const evacuee = {
	_id: 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0',
	type: 'evacuee',
	first_name: 'สุนิตา',
	last_name: 'บางค้างพลู',
	vulnerable_groups: [],
	current_stay: { status: 'arriving', zone: null, since: '2026-10-24T10:00:00.000Z' },
	household_id: 'household:test-1',
	shelter_code: 'SH001'
} as unknown as Evacuee;

const printer = (id: string) => ({
	id,
	name: `เครื่อง-${id}`,
	station: null,
	online: true,
	queue_state: 'ready',
	last_seen_at: '2026-10-22T03:00:00.000Z'
});

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
		flushSync();
	}
}

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const printButton = () => buttons().find((b) => b.textContent?.includes('พิมพ์ที่ เครื่อง-p1'));
const closeButtons = () => buttons().filter((b) => b.textContent?.trim() === 'ปิด');
const pressEscape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	stationPrinter.set('SH001', 'p1');
	endpointStore.markConnected();
	issueQrs.mockImplementation(async (input: { evacuee_ids: string[] }) =>
		input.evacuee_ids.map((evacuee_id) => ({
			evacuee_id,
			status: 'issued',
			qr_payload: `${evacuee_id}@683508`
		}))
	);
	api.listShelterPrinters.mockResolvedValue({
		printers: [printer('p1')],
		server_time: '2026-10-22T03:00:10.000Z'
	});
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('EvacueeQrModal with the station printer button', () => {
	it('shows only the specific toast when the QR cannot be issued, and sends nothing', async () => {
		issueQrs.mockRejectedValue(new Error('offline'));
		instance = mount(Harness, {
			target: document.body,
			props: {
				client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
				show: true,
				evacuee,
				onClose: vi.fn()
			}
		});
		await settle();

		printButton()!.click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ออก QR ใหม่ไม่สำเร็จ'));
		expect(api.createPrintJob).not.toHaveBeenCalled();
	});

	it('stays open while a sent job may still print and closes once its printer leaves the list', async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const onClose = vi.fn();
		instance = mount(Harness, {
			target: document.body,
			props: { client, show: true, evacuee, onClose }
		});
		await settle();
		api.createPrintJob.mockRejectedValueOnce(
			new PrintApiError('unavailable', 503, 'DEPENDENCY_UNAVAILABLE')
		);

		printButton()!.click();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		await settle();
		expect(closeButtons().length).toBeGreaterThan(0);
		expect(closeButtons().every((b) => b.disabled)).toBe(true);
		pressEscape();
		expect(onClose).not.toHaveBeenCalled();

		// The admin deactivates p1: no printer is left, so the print button goes away.
		api.listShelterPrinters.mockResolvedValue({
			printers: [],
			server_time: '2026-10-22T03:00:10.000Z'
		});
		await client.invalidateQueries();
		await settle();

		expect(printButton()).toBeUndefined();
		expect(closeButtons().every((b) => !b.disabled)).toBe(true);
		pressEscape();
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
