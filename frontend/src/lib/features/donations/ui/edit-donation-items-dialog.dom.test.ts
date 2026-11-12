// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import EditDonationItemsDialog from './edit-donation-items-dialog.svelte';

vi.mock('../application/queries', () => ({
	usePublicShelterNeeds: () => ({ data: [] }),
	useUpdateDonationItems: () => ({ mutate: vi.fn(), isPending: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
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
