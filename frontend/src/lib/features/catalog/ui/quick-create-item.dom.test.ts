// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import QuickCreateItem from './quick-create-item.svelte';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { needsReauth: false, user: { name: 'u', roles: ['system_admin'] } }
}));
vi.mock('../application/queries', () => ({
	useItemCategories: () => ({
		data: [
			{
				_id: 'item_category:fuel_energy',
				name: 'เชื้อเพลิงและพลังงาน',
				default_class: 'consumable'
			},
			{ _id: 'item_category:food', name: 'อาหาร', default_class: 'consumable' }
		],
		isLoading: false
	}),
	useItemMasters: () => ({ data: [] }),
	useUnitsOfMeasure: () => ({
		data: [{ code: 'kg', label_th: 'กิโลกรัม', label_en: 'Kilogram', dimension: 'mass' }],
		isLoading: false,
		isError: false
	}),
	useCreateItemMaster: () => ({ mutate: mocks.mutate, isPending: false })
}));
vi.mock('./item-master-form.svelte', async () => ({
	default: (await import('./__fixtures__/item-master-form.fixture.svelte')).default
}));

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(QuickCreateItem, {
		target: document.body,
		props: { shelterCode: 'SH001', onCreated: vi.fn(), onUseExisting: vi.fn(), onCancel: vi.fn() }
	});
	flushSync();
	await tick();
}

const chip = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === label
	)!;

async function fillAndSubmit(category: string) {
	const name = document.body.querySelector<HTMLInputElement>('#qc-name')!;
	name.value = 'น้ำมันดีเซล';
	name.dispatchEvent(new Event('input', { bubbles: true }));
	chip(category).click();
	chip('กิโลกรัม').click();
	flushSync();
	document.body
		.querySelector('form')!
		.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
	await tick();
}

const fullForm = () => document.body.querySelector<HTMLElement>('[data-testid="full-form-stub"]');

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	mocks.mutate.mockClear();
});

describe('QuickCreateItem — fuel category', () => {
	it('opens the full form with the draft instead of creating', async () => {
		await render();
		await fillAndSubmit('เชื้อเพลิงและพลังงาน');

		expect(mocks.mutate).not.toHaveBeenCalled();
		expect(fullForm()?.dataset.name).toBe('น้ำมันดีเซล');
		expect(fullForm()?.dataset.category).toBe('item_category:fuel_energy');
	});

	it('creates straight away for any other category', async () => {
		await render();
		await fillAndSubmit('อาหาร');

		expect(mocks.mutate).toHaveBeenCalledOnce();
		expect(fullForm()).toBeNull();
	});
});
