// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

const h = vi.hoisted(() => ({ store: null as unknown }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('$lib/utils/scroll-app-to-top', () => ({ scrollAppToTop: vi.fn() }));
vi.mock('$lib/features/catalog', async (orig) => {
	const actual = await orig<typeof import('$lib/features/catalog')>();
	return {
		...actual,
		useUnitsOfMeasure: () => ({ data: [] }),
		useUnitDimensionResolver: () => ({
			resolve: (unit: string) => actual.resolveUnitDimension(unit)
		})
	};
});
vi.mock('../../../routes/(public)/donations/donation.svelte', async (orig) => ({
	...(await orig<typeof import('../../../routes/(public)/donations/donation.svelte')>()),
	getDonationStore: () => h.store
}));

const { DonationStore, newDonationItem } =
	await import('../../../routes/(public)/donations/donation.svelte');
const { default: FormDonor } = await import('./form-donor.svelte');

const t = PUBLIC_DONATIONS_I18N.th;
const amountMsg = (i: number) => t.valItemAmount.replace('{index}', String(i));

let store: InstanceType<typeof DonationStore>;
let instance: ReturnType<typeof mount> | null = null;

function render() {
	instance = mount(FormDonor, { target: document.body });
	flushSync();
}
function clickNext() {
	const btn = [...document.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(t.nextBtn)
	);
	btn!.click();
	flushSync();
}

beforeEach(() => {
	toastError.mockReset();
	store = new DonationStore();
	store.donorName = 'สมชาย';
	store.donorPhone = '0812345678';
	store.activeTab = 'form';
	store.reachedStep = 2;
	store.items = [{ ...newDonationItem({ name: 'ข้าวสาร', unit: 'kg' }) }];
	h.store = store;
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('form-donor quantity (#822)', () => {
	// 0.00001 / 0.00004 round to 0 at qty scale (4 dp) — the BFF would 422 them.
	it.each([0, -2, null as unknown as number, 0.00001, 0.00004])(
		'blocks next when amount is %s',
		async (amount) => {
			store.items[0].amount = amount;
			render();
			clickNext();
			await tick();
			expect(document.body.textContent).toContain(amountMsg(1));
			expect(store.activeTab).toBe('form');
			expect(store.reachedStep).toBe(2);
			expect(toastError).toHaveBeenCalled();
			expect(store.items[0].amount).toBe(amount);
		}
	);

	it('reports only the invalid item and focuses its input', async () => {
		store.items = [
			{ ...newDonationItem({ name: 'a', unit: 'kg' }), amount: 5 },
			{ ...newDonationItem({ name: 'b', unit: 'kg' }), amount: 0 },
			{ ...newDonationItem({ name: 'c', unit: 'kg' }), amount: 0 }
		];
		render();
		clickNext();
		await tick();
		await tick();
		expect(document.body.textContent).toContain(amountMsg(2));
		expect(document.body.textContent).not.toContain(amountMsg(1));
		expect(document.activeElement?.id).toBe(`amount-${store.items[1].id}`);
	});

	it('does not focus an amount input when only the name is invalid', async () => {
		store.items = [{ ...newDonationItem({ name: '', unit: 'kg' }), amount: 5 }];
		render();
		clickNext();
		await tick();
		await tick();
		expect(document.activeElement?.id ?? '').not.toContain('amount-');
	});

	// 0.30000000000000004 = 0.1 + 0.2; 0.00005 rounds up to 0.0001 — both are > 0 after rounding.
	it.each([5, 0.5, 0.1 + 0.2, 0.00005])('advances with amount %s', (amount) => {
		store.items[0].amount = amount;
		render();
		clickNext();
		expect(store.activeTab).toBe('time');
		expect(store.reachedStep).toBeGreaterThanOrEqual(3);
		expect(document.body.textContent).not.toContain(amountMsg(1));
	});

	it('shows the shortfall hint for need-derived items only, with a whole-number step for a count unit', () => {
		store.items = [
			newDonationItem({ name: 'ไข่ไก่', unit: 'ฟอง', unit_code: 'piece', qty_needed: 365 }),
			newDonationItem({ name: 'อื่น', unit: 'kg' })
		];
		render();
		const first = document.getElementById(`amount-${store.items[0].id}`) as HTMLInputElement;
		expect(first.getAttribute('min')).toBe('0');
		expect(first.getAttribute('step')).toBe('1');
		expect(first.getAttribute('inputmode')).toBe('numeric');
		expect((document.getElementById(`amount-${store.items[1].id}`) as HTMLInputElement).step).toBe(
			'any'
		);
		expect(first.value).toBe('0');
		const hint = document.querySelector(`[data-testid="need-shortage-${store.items[0].id}"]`);
		expect(hint?.textContent).toContain('ยังขาด 365');
		expect(document.querySelector(`[data-testid="need-shortage-${store.items[1].id}"]`)).toBeNull();
	});
});

describe('form-donor whole quantity for count units (#805)', () => {
	const amountInput = (i = 0) =>
		document.getElementById(`amount-${store.items[i].id}`) as HTMLInputElement;
	const errorOf = (i = 0) =>
		document.querySelector(`[data-testid="amount-error-${store.items[i].id}"]`);
	const next = () =>
		[...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t.nextBtn))!;

	it('shows the error and disables next for 1.5 bottles, even though next is clicked', () => {
		store.items = [{ ...newDonationItem({ name: 'น้ำดื่ม', unit: 'bottle' }), amount: 1.5 }];
		render();
		expect(errorOf()?.textContent?.trim()).toBe(t.editQtyWholeError);
		expect(amountInput().getAttribute('aria-invalid')).toBe('true');
		expect(amountInput().getAttribute('aria-describedby')).toBe(
			`amount-${store.items[0].id}-error`
		);
		expect(amountInput().getAttribute('step')).toBe('1');
		expect(next().disabled).toBe(true);
		clickNext();
		expect(store.activeTab).toBe('form');
	});

	it('accepts 2 bottles', () => {
		store.items = [{ ...newDonationItem({ name: 'น้ำดื่ม', unit: 'bottle' }), amount: 2 }];
		render();
		expect(errorOf()).toBeNull();
		expect(next().disabled).toBe(false);
		clickNext();
		expect(store.activeTab).toBe('time');
	});

	it('accepts 1.5 kg', () => {
		store.items = [{ ...newDonationItem({ name: 'ข้าวสาร', unit: 'kg' }), amount: 1.5 }];
		render();
		expect(errorOf()).toBeNull();
		expect(next().disabled).toBe(false);
		clickNext();
		expect(store.activeTab).toBe('time');
	});

	it('clears the error and re-enables next once the box holds a whole number', async () => {
		store.items = [{ ...newDonationItem({ name: 'น้ำดื่ม', unit: 'bottle' }), amount: 0 }];
		render();
		const input = amountInput();
		input.value = '1.5';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(errorOf()).not.toBeNull();
		expect(next().disabled).toBe(true);
		input.value = '2';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(errorOf()).toBeNull();
		expect(next().disabled).toBe(false);
	});

	it('takes the dimension from unit_code when the label is a legacy word', () => {
		store.items = [
			{ ...newDonationItem({ name: 'ไข่', unit: 'ฟอง', unit_code: 'piece' }), amount: 1.5 }
		];
		render();
		expect(errorOf()).not.toBeNull();
	});

	it('enforces no rule for an unknown unit', () => {
		store.items = [{ ...newDonationItem({ name: 'อื่นๆ', unit: 'zzz' }), amount: 1.5 }];
		render();
		expect(errorOf()).toBeNull();
		expect(next().disabled).toBe(false);
	});
});
