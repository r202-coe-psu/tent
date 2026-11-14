// @vitest-environment happy-dom
// CR-233: the batch page issues QRs only when the print button renders its labels, one request
// for the members being printed (`family_batch`), and prints only the members that were issued.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Evacuee, Household } from '../../domain/people';

const issue = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const rendered = vi.hoisted(() => ({ calls: [] as string[], result: null as unknown }));

vi.mock('svelte-sonner', () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));
vi.mock('$lib/features/people/data/evacuee-qr.api', () => ({ issueEvacueeQrs: issue }));
vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => ({
		fetchQuery: vi.fn().mockResolvedValue([]),
		invalidateQueries: vi.fn()
	})
}));
vi.mock('$lib/features/printers', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/printers')>()),
	PrintLabelsButton: (
		await import('../evacuee-profile/__fixtures__/print-labels-render-stub.svelte')
	).default
}));
vi.mock('$lib/features/kiosk', () => ({
	KIOSK_LABEL_MM: { width: 80, height: 60 },
	renderKioskQrLabelPng: async (payload: string) => {
		// The embedded cards render their on-open placeholder; only issued payloads count here.
		if (payload.startsWith('evacuee:')) rendered.calls.push(payload);
		return 'AAAA';
	}
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

const A = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';
const B = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH1';
const member = (_id: string) =>
	({
		_id,
		type: 'evacuee',
		first_name: 'ชื่อ',
		last_name: 'ทดสอบ',
		vulnerable_groups: [],
		current_stay: { status: 'arriving', zone: null, since: '2026-10-24T10:00:00.000Z' },
		household_id: 'household:test-1',
		shelter_code: 'SH001'
	}) as unknown as Evacuee;
const household = {
	_id: 'household:test-1',
	type: 'household',
	label: 'ครัวเรือน',
	head_evacuee_id: A,
	shelter_code: 'SH001'
} as unknown as Household;

let instance: ReturnType<typeof mount> | null = null;

async function flush() {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
		flushSync();
	}
}

beforeEach(() => {
	issue.mockReset();
	toastError.mockReset();
	rendered.calls = [];
	instance = mount(FamilyBatchPrint, {
		target: document.body,
		props: { household, members: [member(A), member(B)], onDone: vi.fn() }
	});
	flushSync();
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

const clickRender = async () => {
	// The family button is the only printer button on the page.
	const buttons = document.querySelectorAll<HTMLButtonElement>('[data-testid="render-labels"]');
	buttons[buttons.length - 1].click();
	await flush();
};

describe('FamilyBatchPrint QR issuing', () => {
	it('issues family_batch QRs for the printed members only, on click', async () => {
		expect(issue).not.toHaveBeenCalled();
		issue.mockImplementation(async (input: { evacuee_ids: string[] }) =>
			input.evacuee_ids.map((id) => ({
				evacuee_id: id,
				status: 'issued',
				qr_payload: `${id}@683508`
			}))
		);

		await clickRender();

		expect(issue).toHaveBeenCalledTimes(1);
		expect(issue).toHaveBeenCalledWith({
			shelter_code: expect.any(String),
			source: 'family_batch',
			evacuee_ids: [A, B]
		});
		// The cards also re-render their previews with the issued QR, so compare unique payloads.
		expect([...new Set(rendered.calls)].sort()).toEqual([`${A}@683508`, `${B}@683508`]);
	});

	it('does not print a member whose QR was not issued and reports it', async () => {
		issue.mockResolvedValue([
			{ evacuee_id: A, status: 'issued', qr_payload: `${A}@683508` },
			{ evacuee_id: B, status: 'not_found' }
		]);

		await clickRender();

		expect([...new Set(rendered.calls)]).toEqual([`${A}@683508`]);
		expect(toastError).toHaveBeenCalledTimes(1);
	});

	it('prints nothing when the request fails', async () => {
		issue.mockRejectedValue(new Error('offline'));

		await clickRender();

		expect(rendered.calls).toEqual([]);
		expect(toastError).toHaveBeenCalledTimes(1);
	});
});

describe('FamilyBatchPrint card previews', () => {
	const captions = () => [...document.querySelectorAll('figcaption')].map((c) => c.textContent);
	const issueAll = () =>
		issue.mockImplementation(async (input: { evacuee_ids: string[] }) =>
			input.evacuee_ids.map((id) => ({
				evacuee_id: id,
				status: 'issued',
				qr_payload: `${id}@683508`
			}))
		);

	it('shows the placeholder note on every card before any print', () => {
		expect(captions()).toHaveLength(2);
		for (const text of captions()) expect(text).toContain('QR จริงจะออกใหม่เมื่อกดพิมพ์');
	});

	it('updates every card preview after the family print rotates all QRs', async () => {
		issueAll();

		await clickRender();

		expect(captions()).toHaveLength(2);
		for (const text of captions()) expect(text).toContain('QR ล่าสุดที่ออกให้');
	});
});
