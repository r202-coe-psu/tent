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

function type(input: HTMLInputElement, data: string) {
	const event = new InputEvent('beforeinput', { data, inputType: 'insertText', cancelable: true });
	input.dispatchEvent(event);
	return event;
}

describe('EditDonationItemsDialog quantity box', () => {
	it('refuses a decimal point for a count unit and says why', async () => {
		const qty = await openWith('bottle');

		expect(type(qty, '5').defaultPrevented).toBe(false);
		const dot = type(qty, '.');
		flushSync();
		await tick();

		expect(dot.defaultPrevented).toBe(true);
		expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
			'กรอกได้เฉพาะตัวเลข'
		);
	});

	it('still accepts a decimal point for a mass unit', async () => {
		const qty = await openWith('kg');

		expect(type(qty, '.').defaultPrevented).toBe(false);
		expect(document.body.querySelector('[role="status"]')).toBeNull();
	});
});
