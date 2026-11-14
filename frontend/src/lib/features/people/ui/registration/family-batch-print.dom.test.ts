// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Evacuee, Household } from '../../domain/people';

vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => ({ fetchQuery: vi.fn() })
}));
vi.mock('$lib/features/printers', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/printers')>()),
	PrintLabelsButton: (
		await import('../evacuee-profile/__fixtures__/print-labels-button-stub.svelte')
	).default,
	ScannerClientPrintButton: (
		await import('../evacuee-profile/__fixtures__/scanner-client-print-button-stub.svelte')
	).default
}));
const issue = vi.hoisted(() => vi.fn());
vi.mock('$lib/features/people/data/evacuee-qr.api', () => ({ issueEvacueeQrs: issue }));
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

import FamilyBatchPrint from './family-batch-print.svelte';

const member = (id: string) =>
	({
		_id: `evacuee:${id}`,
		type: 'evacuee',
		first_name: `ชื่อ-${id}`,
		last_name: 'ทดสอบ',
		vulnerable_groups: [],
		current_stay: { status: 'arriving', zone: null, since: '2026-10-24T10:00:00.000Z' },
		household_id: 'household:test-1',
		shelter_code: 'SH001'
	}) as unknown as Evacuee;

const household = {
	_id: 'household:test-1',
	type: 'household',
	label: 'ครัวเรือนทดสอบ',
	head_evacuee_id: 'evacuee:a',
	shelter_code: 'SH001'
} as unknown as Household;

let instance: ReturnType<typeof mount> | null = null;

function render() {
	const handlers = { onDone: vi.fn(), onNextStation: vi.fn(), onRegisterAnother: vi.fn() };
	instance = mount(FamilyBatchPrint, {
		target: document.body,
		props: { household, members: [member('a'), member('b')], ...handlers }
	});
	flushSync();
	return handlers;
}

const byTestId = (id: string) => [
	...document.querySelectorAll<HTMLButtonElement>(`[data-testid="${id}"]`)
];
const navButtons = () =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
		['ไปจัดโซน (สถานี 3)', 'ลงทะเบียนครอบครัวถัดไป', 'กลับคิวทะเบียน'].includes(
			b.textContent?.trim() ?? ''
		)
	);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('FamilyBatchPrint', () => {
	it('never issues a QR just by being shown (FR-EQR-21a)', () => {
		render();

		expect(issue).not.toHaveBeenCalled();
	});

	it('shows exactly one station-printer button: the family one (member cards hide theirs)', () => {
		render();

		expect(byTestId('station-print')).toHaveLength(1);
	});

	it('gives member cards no print button of their own (no second issue path)', () => {
		render();

		const cards = [...document.querySelectorAll('section')].filter((c) => c.querySelector('h3'));
		expect(cards).toHaveLength(2);
		for (const card of cards) {
			expect(card.querySelector('[data-testid="station-print"]')).toBeNull();
			const labels = [...card.querySelectorAll('button')].map((b) => b.textContent?.trim());
			expect(labels).not.toContain('พิมพ์บัตรประจำตัว');
		}
		expect(issue).not.toHaveBeenCalled();
	});

	it.each([
		['while printing', 'station-print'],
		['while a job already sent may still print', 'station-retry-held']
	])('keeps the user on the page %s', (_name, toggle) => {
		const handlers = render();
		expect(navButtons().length).toBeGreaterThan(0);

		byTestId(toggle)[0].click();
		flushSync();
		expect(navButtons().every((b) => b.disabled)).toBe(true);

		byTestId(toggle)[0].click();
		flushSync();
		expect(navButtons().every((b) => !b.disabled)).toBe(true);
		navButtons()
			.find((b) => b.textContent?.trim() === 'กลับคิวทะเบียน')
			?.click();
		expect(handlers.onDone).toHaveBeenCalled();
	});
});
