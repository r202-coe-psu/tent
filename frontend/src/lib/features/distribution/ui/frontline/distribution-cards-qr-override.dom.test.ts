// @vitest-environment happy-dom
// CR-233 A1 (FR-EQR-44..50): the cards pass the recipient's expired-QR audit dates on to the
// workflow input, and only for an evacuee recipient.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { RequisitionTicket } from '../../domain/food-supplies';

const record = vi.hoisted(() => ({
	food: vi.fn<(arg: { input: Record<string, unknown> }) => Promise<unknown>>(),
	supplies: vi.fn<(arg: { input: Record<string, unknown> }) => Promise<unknown>>()
}));

vi.mock('../common/RecipientSearchPicker.svelte', async () => ({
	default: (await import('./__fixtures__/recipient-picker-stub.svelte')).default
}));
vi.mock('./InFlightTopUpDialog.svelte', () => ({ default: () => {} }));
vi.mock('./MealEntitlementWarning.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../application/food-supplies/auth', () => ({
	canPerformFrontlineDistribution: () => true
}));

const ok = (data: unknown) => ({
	data,
	isPending: false,
	isError: false,
	isFetching: false,
	refetch: vi.fn()
});
vi.mock('../../application/queries', () => ({
	resolveAuthenticatedAuthorContext: () => ({ shelterCode: 'SH001', createdBy: 'staff:desk' }),
	useDistributionLogs: () => ok([]),
	useDispatchedLotExpiry: () => ok(null),
	useRecordFoodDistribution: () => ({
		mutateAsync: (arg: { input: Record<string, unknown> }) => record.food(arg),
		isPending: false
	}),
	useRecordSuppliesDistribution: () => ({
		mutateAsync: (arg: { input: Record<string, unknown> }) => record.supplies(arg),
		isPending: false
	})
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () => ok([])
}));
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => ok({ items: [] })
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useMedicalByEvacuee: () => ok(null)
}));

import FoodDistributionCard from './FoodDistributionCard.svelte';
import SuppliesDistributionCard from './SuppliesDistributionCard.svelte';

const ticketOf = (type: 'food' | 'supplies') =>
	({
		_id: `requisition_ticket:01J0000000000000000000000${type === 'food' ? 'A' : 'B'}`,
		type: 'requisition_ticket',
		ticket_no: `TKT-${type.toUpperCase()}-1`,
		requisition_type: type,
		meal: type === 'food' ? 'lunch' : undefined,
		destination_location: 'point:a',
		status: 'DISTRIBUTING',
		items: [
			{
				item_id: 'item:rice',
				item_name: 'ข้าวกล่อง',
				type_class: 'CONSUMABLE',
				returnable: false,
				requested_qty: '10',
				allocated_qty: '10'
			}
		]
	}) as unknown as RequisitionTicket;

const QR_OVERRIDE = {
	issued_at: '2026-11-08T06:52:00.000Z',
	current_printed_at: '2026-11-08T06:53:00.000Z',
	overridden_at: '2026-11-08T07:00:00.000Z'
};

let instance: ReturnType<typeof mount> | null = null;

const click = (testId: string) =>
	document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click();
const buttonByText = (pattern: RegExp) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		pattern.test((b.textContent ?? '').trim())
	);

async function settle() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
		flushSync();
	}
	await tick();
}

beforeEach(() => {
	record.food.mockReset().mockResolvedValue({});
	record.supplies.mockReset().mockResolvedValue({});
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe.each([
	{
		name: 'FoodDistributionCard',
		type: 'food' as const,
		Card: FoodDistributionCard,
		submit: /^ยืนยันแจก /,
		mock: record.food
	},
	{
		name: 'SuppliesDistributionCard',
		type: 'supplies' as const,
		Card: SuppliesDistributionCard,
		submit: /ยืนยันบันทึกแจกจ่ายพัสดุ/,
		mock: record.supplies
	}
])('$name expired QR override (CR-233 A1)', ({ type, Card, submit, mock }) => {
	async function submitWith(pick: string) {
		instance = mount(Card, {
			target: document.body,
			props: { ticket: ticketOf(type), shelterCode: 'SH001' }
		});
		flushSync();
		click(pick);
		await settle();
		buttonByText(submit)!.click();
		await settle();
	}

	it('sends the QR override dates with an evacuee recipient picked by an expired QR', async () => {
		await submitWith('pick-evacuee-qr-override');

		expect(mock).toHaveBeenCalledTimes(1);
		expect(mock.mock.calls[0][0].input).toMatchObject({
			recipient_type: 'evacuee',
			recipient_id: 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0',
			recipient_qr_override: QR_OVERRIDE
		});
	});

	it('sends no override for an evacuee picked normally', async () => {
		await submitWith('pick-evacuee');

		expect(mock).toHaveBeenCalledTimes(1);
		expect(mock.mock.calls[0][0].input.recipient_qr_override).toBeUndefined();
	});

	it('sends no override for an outside recipient', async () => {
		await submitWith('pick-outside');

		expect(mock).toHaveBeenCalledTimes(1);
		expect(mock.mock.calls[0][0].input).toMatchObject({ recipient_type: 'outside' });
		expect(mock.mock.calls[0][0].input.recipient_qr_override).toBeUndefined();
	});
});
