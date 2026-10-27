// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

const h = vi.hoisted(() => ({ store: null as unknown }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('$lib/utils/scroll-app-to-top', () => ({ scrollAppToTop: vi.fn() }));
vi.mock('$lib/features/catalog', async (orig) => ({
	...(await orig<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
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

	it('keeps min=1 and shows the shortfall hint for need-derived items only', () => {
		store.items = [
			newDonationItem({ name: 'ไข่ไก่', unit: 'ฟอง', unit_code: 'piece', qty_needed: 365 }),
			newDonationItem({ name: 'อื่น', unit: 'kg' })
		];
		render();
		const first = document.getElementById(`amount-${store.items[0].id}`) as HTMLInputElement;
		expect(first.getAttribute('min')).toBe('1');
		expect(first.value).toBe('0');
		const hint = document.querySelector(`[data-testid="need-shortage-${store.items[0].id}"]`);
		expect(hint?.textContent).toContain('ยังขาด 365');
		expect(document.querySelector(`[data-testid="need-shortage-${store.items[1].id}"]`)).toBeNull();
	});
});
