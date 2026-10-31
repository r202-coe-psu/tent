// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import CreateCampaignForm from './create-campaign-form.svelte';

const mocks = vi.hoisted(() => ({ roles: ['system_admin'] as string[] }));

const masters = [
	{
		_id: 'item_master:rice',
		type: 'item_master',
		name: 'ข้าวสาร',
		base_unit: 'kg',
		category: 'item_category:food'
	},
	{
		_id: 'item_master:new',
		type: 'item_master',
		name: 'น้ำปลา',
		base_unit: 'bottle',
		category: 'item_category:food'
	}
];

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => ({ data: [], isPending: false }) }));
vi.mock('$lib/features/catalog', async (importOriginal) => {
	const stub = (await import('./__fixtures__/quick-create-item-sheet.fixture.svelte')).default;
	return {
		...(await importOriginal<typeof import('$lib/features/catalog')>()),
		useItemMasters: () => ({ data: masters, isPending: false }),
		useUnitsOfMeasure: () => ({ data: [] }),
		QuickCreateItemSheet: stub
	};
});

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(CreateCampaignForm, {
		target: document.body,
		props: { onclose: vi.fn(), onsubmit: vi.fn() }
	});
	flushSync();
	await tick();
}

const q = <T extends Element>(sel: string) => document.body.querySelector<T>(sel);
const addButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('เพิ่มสินค้าใหม่')
	);

async function click(el: Element | null | undefined) {
	(el as HTMLElement).click();
	flushSync();
	await tick();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	mocks.roles = ['system_admin'];
});

describe('create campaign form — create a master item', () => {
	it('shows the add button for a role that can write the catalog', async () => {
		await render();
		expect(addButton()).toBeTruthy();
		expect(document.body.textContent).toContain('ไม่พบรายการ? กด');
	});

	it('shows no button and keeps the old helper text without permission', async () => {
		mocks.roles = ['volunteer'];
		await render();
		expect(addButton()).toBeUndefined();
		expect(document.body.textContent).toContain('ให้สร้างในหน้าจัดการข้อมูลหลักก่อน');
	});

	it('opens the sheet with an empty name', async () => {
		await render();
		q<HTMLInputElement>('#campaign-item-title')!.value = 'น้ำมันพืช';
		await click(addButton());
		expect(q('[data-testid="sheet-stub"]')?.getAttribute('data-initial-name')).toBe('');
	});

	it('selects the created item and keeps the other fields', async () => {
		await render();
		const qty = q<HTMLInputElement>('#campaign-target-qty')!;
		const desc = q<HTMLTextAreaElement>('#campaign-description')!;
		qty.value = '50';
		qty.dispatchEvent(new Event('input', { bubbles: true }));
		desc.value = 'ทำอาหาร';
		desc.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		await click(addButton());
		await click(q('[data-testid="stub-created"]'));

		expect(q<HTMLInputElement>('#campaign-item-title')!.value).toBe('น้ำปลา (ขวด)');
		expect(q('[data-testid="sheet-stub"]')).toBeNull();
		expect(q<HTMLInputElement>('#campaign-target-qty')!.value).toBe('50');
		expect(q<HTMLTextAreaElement>('#campaign-description')!.value).toBe('ทำอาหาร');
	});

	it('selects the existing item when "use this one instead" is chosen', async () => {
		await render();
		await click(addButton());
		await click(q('[data-testid="stub-existing"]'));
		expect(q<HTMLInputElement>('#campaign-item-title')!.value).toContain('ข้าวสาร');
	});
});
