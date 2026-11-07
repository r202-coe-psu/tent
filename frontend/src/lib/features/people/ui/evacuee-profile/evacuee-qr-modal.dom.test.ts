// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Evacuee } from '$lib/features/people';

vi.mock('$lib/features/printers', async () => ({
	PrintLabelsButton: (await import('./__fixtures__/print-labels-button-stub.svelte')).default
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

import EvacueeQrModal from './evacuee-qr-modal.svelte';

const evacuee = {
	_id: 'evacuee:test-1',
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
