// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import MealPlanForm from './meal-plan-form.svelte';

const OCCUPANCY = { total: 20, halal: 2, soft_food: 1, infant: 1 };
const SOP = { _id: 'sop_profile:1', version: 1, name: 'SOP' };
const RICE = { _id: 'supply_item:rice', name: 'ข้าวสาร', category: 'food', unit: 'kg' };

vi.mock('$lib/features/kitchen', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/kitchen')>()),
	useCreateMealPlanCalc: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateMealPlanCalc: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useOccupancyHeadcount: () => ({ data: OCCUPANCY, isPending: false })
}));
vi.mock('$lib/features/sop-ratios', () => ({
	useActiveSopProfile: () => ({ data: SOP, isPending: false })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useRecipes: () => ({ data: [] }),
	useItemMasters: () => ({ data: [] }),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/features/supply', () => ({
	useSupplyItems: () => ({ data: [RICE], isPending: false })
}));
vi.mock('$lib/features/operations', () => ({
	useStockBalance: () => ({ data: new Map() })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/stores/auth.svelte', () => ({ authStore: { user: { name: 'kitchen' } } }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function render() {
	instance = mount(MealPlanForm, {
		target: document.body,
		props: { open: true, defaultMode: 'custom' }
	});
	await settle();
}

async function enter(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

const alerts = () =>
	[...document.body.querySelectorAll('[role="alert"]')].map((el) => el.textContent?.trim());
const submit = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button[type="submit"]')][0];

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

/** Fires the select binding so the row takes its first enabled option, the rice supply item. */
async function pickFirstItem(rowIndex: number) {
	const select = document.querySelectorAll('select')[rowIndex + 1] as HTMLSelectElement;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	await settle();
}

/** One valid ingredient row, so the submit button is enabled until a number goes bad. */
async function renderValid() {
	await render();
	await pickFirstItem(0);
	await enter('mp-qty-0', '1');
	expect(alerts()).toEqual([]);
	expect(submit().disabled).toBe(false);
}

const NEGATIVE = 'ไม่รับค่าติดลบ';
const NON_NUMERIC = 'กรอกได้เฉพาะตัวเลข';
const TOTAL_ERROR = 'ต้องมากกว่า 0';

const box = (id: string) => document.getElementById(id) as HTMLInputElement;

function pressKey(id: string, key: string) {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	box(id).dispatchEvent(event);
	return event;
}

async function paste(id: string, text: string) {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
	box(id).dispatchEvent(event);
	await settle();
	return event;
}

describe('meal plan form numeric inputs (#803)', () => {
	it('clamps a negative per-person quantity on an added row to 0 and says so', async () => {
		await renderValid();
		const addRow = [...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('เพิ่มวัตถุดิบ')
		)!;
		addRow.click();
		await settle();

		await enter('mp-qty-1', '-2');

		expect(box('mp-qty-1').value).toBe('0');
		expect(alerts()).toEqual([NEGATIVE]);

		await enter('mp-qty-1', '0.25');
		expect(box('mp-qty-1').value).toBe('0.25');
		expect(alerts()).toEqual([]);
		expect(submit().disabled).toBe(false);
	});

	it.each(['mp-halal', 'mp-soft', 'mp-infant'])('clamps a negative %s to 0', async (id) => {
		await renderValid();
		await enter(id, '-1');

		expect(box(id).value).toBe('0');
		expect(alerts()).toEqual([NEGATIVE]);

		await enter(id, '1');
		expect(alerts()).toEqual([]);
	});

	it('clamps a negative total to 0 and keeps the total-above-zero error and disabled save', async () => {
		await renderValid();
		await enter('mp-total', '-5');

		expect(box('mp-total').value).toBe('0');
		expect(alerts()).toEqual([NEGATIVE, TOTAL_ERROR]);
		expect(submit().disabled).toBe(true);

		await enter('mp-total', '0');
		expect(alerts()).toEqual([TOTAL_ERROR]);
		expect(submit().disabled).toBe(true);

		await enter('mp-total', '20');
		expect(alerts()).toEqual([]);
		expect(submit().disabled).toBe(false);
	});

	it('blocks the minus, plus and exponent keys and explains why', async () => {
		await renderValid();

		expect(pressKey('mp-halal', '-').defaultPrevented).toBe(true);
		await settle();
		expect(alerts()).toEqual([NEGATIVE]);

		for (const key of ['+', 'e', 'E']) {
			expect(pressKey('mp-halal', key).defaultPrevented).toBe(true);
		}
		await settle();
		expect(alerts()).toEqual([NON_NUMERIC]);

		expect(pressKey('mp-halal', '5').defaultPrevented).toBe(false);
		await enter('mp-halal', '5');
		expect(alerts()).toEqual([]);
	});

	it('rejects a pasted negative or non-numeric value but accepts an unsigned one', async () => {
		await renderValid();

		expect((await paste('mp-halal', '-5')).defaultPrevented).toBe(true);
		expect(alerts()).toEqual([NEGATIVE]);

		expect((await paste('mp-halal', '1e3')).defaultPrevented).toBe(true);
		expect(alerts()).toEqual([NON_NUMERIC]);

		expect((await paste('mp-halal', '2.5')).defaultPrevented).toBe(false);
		await enter('mp-halal', '2.5');
		expect(alerts()).toEqual([]);
	});
});
