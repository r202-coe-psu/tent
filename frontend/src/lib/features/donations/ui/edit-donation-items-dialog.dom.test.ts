// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import EditDonationItemsDialog from './edit-donation-items-dialog.svelte';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../application/queries', () => ({
	usePublicShelterNeeds: () => ({ data: [] }),
	useUpdateDonationItems: () => ({ mutate: mocks.mutate, isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
	mocks.mutate.mockReset();
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

async function openWith(unit: string) {
	instance = mount(EditDonationItemsDialog, {
		target: document.body,
		props: {
			open: true,
			token: 't',
			shelterCode: 'SH001',
			items: [{ line_key: 'a', item_name: 'น้ำดื่ม', qty: 2, unit }]
		}
	});
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
	return document.body.querySelector<HTMLInputElement>('#qty-0')!;
}

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	await tick();
}

const WHOLE_ERROR = 'หน่วยนับต้องเป็นจำนวนเต็ม';
const saveButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('บันทึกการแก้ไข')
	)!;

describe('EditDonationItemsDialog quantity box', () => {
	it('keeps a decimal typed into a count unit, flags it, and blocks save', async () => {
		const qty = await openWith('bottle');
		expect(saveButton().disabled).toBe(false);

		await type(qty, '1.5');

		expect(qty.value).toBe('1.5');
		expect(document.body.textContent).toContain(WHOLE_ERROR);
		expect(qty.getAttribute('aria-invalid')).toBe('true');
		expect(saveButton().disabled).toBe(true);

		await type(qty, '2');
		expect(document.body.textContent).not.toContain(WHOLE_ERROR);
		expect(saveButton().disabled).toBe(false);
	});

	it('accepts a decimal for a mass unit', async () => {
		const qty = await openWith('kg');

		await type(qty, '1.5');

		expect(qty.value).toBe('1.5');
		expect(document.body.textContent).not.toContain(WHOLE_ERROR);
		expect(saveButton().disabled).toBe(false);
	});
});

// #939 / CR-038 — the quantity is persisted as a decimal string, never through float Number().
const QTY_FORMAT_ERROR = 'ปริมาณต้องเป็นตัวเลขไม่เกิน 4 ตำแหน่งทศนิยม';

describe('EditDonationItemsDialog quantity persistence (#939)', () => {
	it('saves 0.30000 as "0.3"', async () => {
		const qty = await openWith('kg');
		await type(qty, '0.30000');
		expect(saveButton().disabled).toBe(false);

		saveButton().click();

		expect(mocks.mutate).toHaveBeenCalledTimes(1);
		expect(mocks.mutate.mock.calls[0][0].items[0].qty).toBe('0.3');
	});

	it.each(['1e3', '0.12345', '1e21'])('rejects %s with a message and does not save', async (v) => {
		const qty = await openWith('kg');
		await type(qty, v);

		expect(document.body.textContent).toContain(QTY_FORMAT_ERROR);
		expect(qty.getAttribute('aria-invalid')).toBe('true');
		expect(saveButton().disabled).toBe(true);
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it('flags text the browser threw away, instead of leaving a silent disabled button (#939 S1)', async () => {
		const qty = await openWith('kg');
		// A number box sanitises `1.2.3` to '' and only says so through validity.badInput.
		Object.defineProperty(qty, 'validity', { value: { badInput: true }, configurable: true });
		await type(qty, '');

		expect(document.body.textContent).toContain(QTY_FORMAT_ERROR);
		expect(qty.getAttribute('aria-invalid')).toBe('true');
		expect(saveButton().disabled).toBe(true);

		// Once the box holds a real number again, the message goes away.
		Object.defineProperty(qty, 'validity', { value: { badInput: false }, configurable: true });
		await type(qty, '2.5');
		expect(document.body.textContent).not.toContain(QTY_FORMAT_ERROR);
		expect(saveButton().disabled).toBe(false);
	});

	it('rejects zero', async () => {
		const qty = await openWith('kg');
		await type(qty, '0.00000');
		expect(saveButton().disabled).toBe(true);
	});
});
