// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import CreateCampaignForm from './create-campaign-form.svelte';

const mocks = vi.hoisted(() => ({
	roles: ['system_admin'] as string[],
	/** Legacy `item:` rows (`useSupplyItems`); they win a name clash in the picker. */
	supply: [] as { _id: string; name: string; unit: string; category: string }[],
	/** What `resolveShelterCode` returns; `null` = no shelter selected or scoped. */
	shelter: 'SH001' as string | null,
	toastInfo: vi.fn(),
	toastError: vi.fn()
}));

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

vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: mocks.toastError, info: mocks.toastInfo }
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => mocks.shelter ?? 'SH001',
	resolveShelterCode: () => mocks.shelter
}));
vi.mock('$lib/features/supply', () => ({
	useSupplyItems: () => ({ data: mocks.supply, isPending: false })
}));
// No drop-off points: the point field stays hidden and needs no shelter query (#1085).
vi.mock('$lib/features/operations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/operations')>()),
	useDonationPoints: () => ({ points: [], isLoaded: true })
}));
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
	mocks.supply = [];
	mocks.shelter = 'SH001';
	mocks.toastInfo.mockClear();
	mocks.toastError.mockClear();
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

	it('shows no button when no shelter resolves, instead of creating in SH001', async () => {
		mocks.shelter = null;
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

	it('selects the legacy row when the new item is named like one', async () => {
		mocks.supply = [{ _id: 'item:fish-sauce', name: 'น้ำปลา', unit: 'bottle', category: 'food' }];
		await render();
		await click(addButton());
		await click(q('[data-testid="stub-created"]'));

		expect(q<HTMLInputElement>('#campaign-item-title')!.value).toBe('น้ำปลา (ขวด)');
		expect(mocks.toastInfo).toHaveBeenCalledWith(expect.stringContaining('น้ำปลา'));
	});

	it('selects the legacy twin of an existing item without a notice', async () => {
		mocks.supply = [{ _id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', category: 'food' }];
		await render();
		await click(addButton());
		await click(q('[data-testid="stub-existing"]'));

		expect(q<HTMLInputElement>('#campaign-item-title')!.value).toContain('ข้าวสาร');
		expect(mocks.toastInfo).not.toHaveBeenCalled();
	});
});

describe('create campaign form — validation and submit', () => {
	/** Superforms validates and applies its result across timers, not just microtasks. */
	async function settle() {
		for (let i = 0; i < 3; i++) {
			flushSync();
			await tick();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	async function renderWith(onsubmit = vi.fn()) {
		instance = mount(CreateCampaignForm, {
			target: document.body,
			props: { onclose: vi.fn(), onsubmit }
		});
		await settle();
		return onsubmit;
	}
	const submitButton = () => q<HTMLButtonElement>('button[type="submit"]')!;
	const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? '';
	async function fill(selector: string, value: string) {
		const el = q<HTMLInputElement | HTMLTextAreaElement>(selector)!;
		el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
	}

	it('marks every missing field, focuses the first and submits nothing', async () => {
		const onsubmit = await renderWith();

		submitButton().click();
		await settle();

		expect(text('campaign-item-title-error')).toBe('กรุณาเลือกรายการสิ่งของจากแคตตาล็อก');
		expect(text('campaign-target-qty-error')).toBe('กรุณาระบุจำนวนเป้าหมาย');
		expect(text('campaign-description-error')).toBe('กรุณาระบุเหตุผลหรือรายละเอียดเพิ่มเติม');
		const target = q<HTMLInputElement>('#campaign-target-qty')!;
		expect(target.getAttribute('aria-invalid')).toBe('true');
		expect(target.getAttribute('aria-describedby')).toBe('campaign-target-qty-error');
		expect(mocks.toastError).toHaveBeenCalledWith('กรุณาแก้ไขข้อมูลที่ไม่ถูกต้องในแบบฟอร์ม');
		expect(document.activeElement?.id).toBe('campaign-item-title');
		expect(onsubmit).not.toHaveBeenCalled();
	});

	it('rejects a zero target, then clears the message once it is fixed', async () => {
		await renderWith();
		await fill('#campaign-target-qty', '0');

		submitButton().click();
		await settle();
		expect(text('campaign-target-qty-error')).toBe('จำนวนเป้าหมายต้องเป็นตัวเลขมากกว่า 0');

		await fill('#campaign-target-qty', '5');
		expect(text('campaign-target-qty-error')).toBe('');
	});

	it('hands the picked item, target and details to onsubmit', async () => {
		const onsubmit = await renderWith();
		await click(addButton());
		await click(q('[data-testid="stub-existing"]'));
		await fill('#campaign-target-qty', '50');
		await fill('#campaign-description', '  ทำอาหาร  ');

		submitButton().click();
		await settle();

		expect(mocks.toastError).not.toHaveBeenCalled();
		expect(onsubmit).toHaveBeenCalledTimes(1);
		expect(onsubmit).toHaveBeenCalledWith({
			itemId: 'item_master:rice',
			name: 'ข้าวสาร',
			target: '50',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			category: 'อาหารและเครื่องดื่ม',
			unit: 'kg',
			urgency: 'critical',
			description: 'ทำอาหาร',
			dropOffPointId: null
		});
	});
});
