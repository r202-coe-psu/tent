// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Evacuee } from '$lib/features/people';

vi.mock('$lib/features/printers', async () => ({
	ReportedRenderError: (await import('$lib/features/printers/domain/reported-error'))
		.ReportedRenderError,
	PrintLabelsButton: (await import('./__fixtures__/print-labels-button-stub.svelte')).default
}));
const issue = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const renderPng = vi.hoisted(() => vi.fn(async () => 'AAAA'));
vi.mock('svelte-sonner', () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));
vi.mock('$lib/utils/pdf', () => ({ previewImageAsPdf: vi.fn() }));
vi.mock('$lib/features/people/data/evacuee-qr.api', () => ({ issueEvacueeQrs: issue }));
vi.mock('$lib/features/kiosk', () => ({
	KIOSK_LABEL_MM: { width: 80, height: 60 },
	renderKioskQrLabelPng: renderPng
}));
vi.mock('$lib/features/shelters', () => ({ useShelter: () => ({ data: undefined }) }));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useScreeningsByEvacuee: () => ({ data: [] })
}));

import EvacueeQrModal from './evacuee-qr-modal.svelte';

const evacuee = {
	_id: 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0',
	type: 'evacuee',
	first_name: 'สุนิตา',
	last_name: 'บางค้างพลู',
	current_stay: { status: 'arriving', zone: null, since: '2026-10-24T10:00:00.000Z' },
	household_id: 'household:test-1',
	shelter_code: 'SH001'
} as unknown as Evacuee;

let instance: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown> = {}) {
	const onClose = vi.fn();
	instance = mount(EvacueeQrModal, {
		target: document.body,
		props: { show: true, evacuee, onClose, ...props }
	});
	flushSync();
	return onClose;
}

const stationPrint = () =>
	document.querySelector<HTMLButtonElement>('[data-testid="station-print"]');
const stationRetryHeld = () =>
	document.querySelector<HTMLButtonElement>('[data-testid="station-retry-held"]');
/** The modal's own close buttons (X and the bottom one), by their accessible name. */
const closeButtons = () =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].filter(
		(b) => b.textContent?.trim() === 'ปิดหน้าต่าง'
	);
const pressEscape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('EvacueeQrModal', () => {
	it('cannot be closed while a station print is running', () => {
		const onClose = render();
		stationPrint()!.click();
		flushSync();

		expect(closeButtons()).toHaveLength(2);
		expect(closeButtons().every((b) => b.disabled)).toBe(true);
		pressEscape();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('cannot be closed while a job already sent may still print', () => {
		const onClose = render();
		stationRetryHeld()!.click();
		flushSync();

		expect(closeButtons().every((b) => b.disabled)).toBe(true);
		pressEscape();
		expect(onClose).not.toHaveBeenCalled();

		stationRetryHeld()!.click();
		flushSync();
		pressEscape();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('closes again once the print run ends', () => {
		const onClose = render();
		stationPrint()!.click();
		flushSync();
		stationPrint()!.click();
		flushSync();

		pressEscape();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('hides the station-printer button when the host prints the labels itself', () => {
		render({ printable: false, embedded: true, dismissible: false });

		expect(stationPrint()).toBeNull();
	});
});

describe('EvacueeQrModal QR issuing (CR-233)', () => {
	const flush = async () => {
		for (let i = 0; i < 20; i++) {
			await Promise.resolve();
			flushSync();
		}
	};
	const pdfButton = () =>
		[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
			b.textContent?.includes('พิมพ์บัตรประจำตัว')
		)!;

	beforeEach(() => {
		issue.mockReset();
		toastError.mockReset();
		renderPng.mockClear();
		vi.stubGlobal('open', () => ({ close: vi.fn(), document: {}, location: {} }));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('opens with a placeholder QR and never calls the issue endpoint (FR-EQR-21a)', async () => {
		render();
		await flush();

		expect(issue).not.toHaveBeenCalled();
		expect(renderPng).toHaveBeenCalled();
		for (const call of renderPng.mock.calls as unknown as [string][]) {
			expect(call[0].startsWith('evacuee:')).toBe(false);
		}
	});

	it('issues once per print click and renders the real payload (FR-EQR-21b)', async () => {
		issue.mockImplementation(async (input: { evacuee_ids: string[]; source: string }) => [
			{
				evacuee_id: input.evacuee_ids[0],
				status: 'issued',
				qr_payload: `${input.evacuee_ids[0]}@683508`
			}
		]);
		render();
		await flush();
		renderPng.mockClear();

		pdfButton().click();
		await flush();

		expect(issue).toHaveBeenCalledTimes(1);
		expect(issue).toHaveBeenCalledWith({
			shelter_code: expect.any(String),
			source: 'profile',
			evacuee_ids: [evacuee._id]
		});
		expect(renderPng).toHaveBeenCalledWith(`${evacuee._id}@683508`, expect.anything());

		await vi.waitFor(() => expect(pdfButton()).toBeDefined());
		pdfButton().click();
		await flush();
		expect(issue).toHaveBeenCalledTimes(2);
	});

	it('does not render a printable label when the item is not issued', async () => {
		issue.mockResolvedValue([{ evacuee_id: evacuee._id, status: 'not_found' }]);
		render();
		await flush();
		renderPng.mockClear();

		pdfButton().click();
		await flush();

		expect(renderPng).not.toHaveBeenCalled();
		expect(toastError).toHaveBeenCalledTimes(1);
	});
});
