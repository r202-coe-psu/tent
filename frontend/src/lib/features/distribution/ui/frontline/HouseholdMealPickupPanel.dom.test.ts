// @vitest-environment happy-dom
// #1154: what the food desk sees and taps on the household pickup panel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const A = 'evacuee:01J0000000000000000000000A';
const B = 'evacuee:01J0000000000000000000000B';
const C = 'evacuee:01J0000000000000000000000C';
const NOW = Date.parse('2026-11-05T05:00:00.000Z');

const state = vi.hoisted(() => ({
	record: vi.fn<(arg: { input: { selections: { evacuee_id: string }[] } }) => Promise<unknown>>(),
	logsPending: false,
	logs: [] as unknown[]
}));

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ok = (data: unknown, isPending = false) => ({
	data,
	isPending,
	isError: false,
	isFetching: false,
	refetch: vi.fn()
});
vi.mock('../../application/queries', () => ({
	useRecordHouseholdMealPickup: () => ({
		mutateAsync: (arg: { input: { selections: { evacuee_id: string }[] } }) => state.record(arg),
		isPending: false
	}),
	useRecipientsDistributionLogs: () =>
		ok(state.logsPending ? undefined : state.logs, state.logsPending),
	useEvacueeAllergies: () => ok({})
}));
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => ok({ items: [] })
}));
vi.mock('$lib/features/people', async (importOriginal) => {
	const member = (_id: string, first_name: string) => ({
		_id,
		first_name,
		last_name: 'ใจดี',
		current_stay: { status: 'active' }
	});
	return {
		...(await importOriginal<typeof import('$lib/features/people')>()),
		useHousehold: () => ok({ label: 'ใจดี' }),
		useHouseholdMembers: () => ok([member(A, 'ก'), member(B, 'ข'), member(C, 'ค')])
	};
});

import HouseholdMealPickupPanel from './HouseholdMealPickupPanel.svelte';

const lunchLog = (recipient_id: string) => ({
	recipient_id,
	meal: 'lunch',
	status: 'fulfilled',
	is_returnable: false,
	distributed_at: '2026-11-05T04:30:00.000Z'
});

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
		flushSync();
	}
	await tick();
}

function open() {
	instance = mount(HouseholdMealPickupPanel, {
		target: document.body,
		props: {
			ticketId: 'requisition_ticket:T',
			meal: 'lunch',
			item: { item_id: 'item:rice', item_name: 'ข้าวกล่อง' },
			menu: undefined,
			inHandQty: '10',
			collectorId: B,
			householdId: 'household:1',
			notes: '',
			shelterCode: 'SH001',
			canDistribute: true,
			now: NOW,
			ondone: vi.fn()
		} as never
	});
	flushSync();
}

const box = (id: string) =>
	document.querySelector<HTMLElement>(`#household-member-${CSS.escape(id)}`)!;
const isTicked = (id: string) => box(id).getAttribute('aria-checked') === 'true';
const submitButton = () =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		/ยืนยันแจก/.test(b.textContent ?? '')
	);

beforeEach(() => {
	state.logsPending = false;
	state.logs = [];
	state.record.mockReset();
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('HouseholdMealPickupPanel', () => {
	it('ticks nobody and shows no rows while the pickup history is still loading', async () => {
		state.logsPending = true;
		open();
		await settle();

		expect(document.body.textContent).toContain('กำลังโหลดสมาชิกและประวัติการรับ');
		expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
		expect(submitButton()!.disabled).toBe(true);
	});

	it('does not tick a member who already received this meal, and says so', async () => {
		state.logs = [lunchLog(A)];
		open();
		await settle();

		expect(isTicked(A)).toBe(false);
		expect(isTicked(B)).toBe(true);
		expect(isTicked(C)).toBe(true);
		expect(document.body.textContent).toContain('รับมื้อนี้แล้ว 1 จาก 3 คน');
		expect(document.body.textContent).toContain('ไม่ได้เลือกไว้ให้ เพราะ');
		expect(submitButton()!.textContent).toContain('ให้ 2 คน');
	});

	it('keeps only the members whose save failed ticked after a partial failure', async () => {
		state.record.mockResolvedValue([
			{ evacuee_id: B, ok: true },
			{ evacuee_id: A, ok: true },
			{ evacuee_id: C, ok: false, error: new Error('boom') }
		]);
		open();
		await settle();
		submitButton()!.click();
		await settle();

		expect(state.record).toHaveBeenCalledTimes(1);
		expect(state.record.mock.calls[0][0].input.selections.map((s) => s.evacuee_id).sort()).toEqual(
			[A, B, C].sort()
		);
		expect(isTicked(A)).toBe(false);
		expect(isTicked(B)).toBe(false);
		expect(isTicked(C)).toBe(true);
		expect(document.body.textContent).toContain('บันทึกไม่สำเร็จ 1 คน');
		expect(submitButton()!.textContent).toContain('ให้ 1 คน');
	});
});
