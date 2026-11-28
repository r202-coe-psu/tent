// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { NeedItem } from '$lib/features/operations';
import EditCampaignForm from './edit-campaign-form.svelte';

const toastError = vi.hoisted(() => vi.fn());
const donationPoints = vi.hoisted(() => ({ list: [] as { id: string; name: string }[] }));

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: toastError, info: vi.fn() } }));
vi.mock('$lib/features/operations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/operations')>()),
	useDonationPoints: () => ({ points: donationPoints.list, isLoaded: true })
}));
vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => ({ data: [], isPending: false }) }));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () => ({ data: [], isPending: false }),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));

const ITEM_ID = 'item_master:rice';

/** A campaign for one need: 100 kg wanted, 40 kg already pledged by donors. */
const campaign = (dropOffPointId: string | null = null): NeedItem => ({
	id: 'campaign:1',
	title: 'ข้าวสาร',
	location: '',
	showOnHome: true,
	closeState: 'open',
	isManualClosed: false,
	needs: [
		{
			itemId: ITEM_ID,
			name: 'ข้าวสาร',
			reserved: '40',
			onHand: '0',
			target: '100',
			remaining: '60',
			unit: 'kg',
			closeState: 'open',
			isManualClosed: false,
			dropOffPointId
		}
	],
	campaignDoc: {} as NeedItem['campaignDoc']
});

let instance: ReturnType<typeof mount> | null = null;

/** Superforms validates and applies its result across timers, not just microtasks. */
async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

async function render(item: NeedItem = campaign()) {
	const onsubmit = vi.fn();
	instance = mount(EditCampaignForm, {
		target: document.body,
		props: { item, itemId: ITEM_ID, onclose: vi.fn(), onsubmit }
	});
	await settle();
	return onsubmit;
}

async function type(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

const submit = () => document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? '';

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	toastError.mockReset();
	donationPoints.list = [];
});

describe('edit campaign form', () => {
	it('refuses a target below what donors pledged, and points at the field', async () => {
		const onsubmit = await render();
		await type('edit-item-target', '30');
		// The explanation shows while typing; the inline error waits for a save attempt.
		expect(document.body.textContent).toContain('ตั้งเป้าต่ำกว่ายอดที่จองไว้แล้วไม่ได้');
		expect(text('edit-item-target-error')).toBe('');

		submit().click();
		await settle();

		expect(text('edit-item-target-error')).toBe(
			'ตั้งเป้าต่ำกว่ายอดที่ผู้บริจาคจองไว้แล้ว (40 kg) ไม่ได้'
		);
		const target = document.getElementById('edit-item-target')!;
		expect(target.getAttribute('aria-invalid')).toBe('true');
		expect(target.getAttribute('aria-describedby')).toBe('edit-item-target-error');
		expect(document.activeElement).toBe(target);
		expect(toastError).toHaveBeenCalledWith('กรุณาแก้ไขข้อมูลที่ไม่ถูกต้องในแบบฟอร์ม');
		expect(onsubmit).not.toHaveBeenCalled();
	});

	it('asks for a title', async () => {
		const onsubmit = await render();
		await type('edit-campaign-title', '   ');

		submit().click();
		await settle();

		expect(text('edit-campaign-title-error')).toBe('กรุณาระบุชื่อประกาศ');
		expect(document.activeElement?.id).toBe('edit-campaign-title');
		expect(onsubmit).not.toHaveBeenCalled();
	});

	it('allows lowering the target to exactly the pledged figure', async () => {
		const onsubmit = await render();
		await type('edit-item-target', '40');
		await type('edit-item-details', '  ต้องการด่วน  ');

		submit().click();
		await settle();

		expect(toastError).not.toHaveBeenCalled();
		expect(onsubmit).toHaveBeenCalledWith({
			title: 'ข้าวสาร',
			category: 'อื่นๆ',
			unit: 'kg',
			target: '40',
			urgency: 'normal',
			imageUrl: '',
			description: 'ต้องการด่วน',
			dropOffPointId: null
		});
	});

	it('keeps the stored drop-off point when the shelter has several to choose from', async () => {
		donationPoints.list = [
			{ id: 'point:a', name: 'จุด A' },
			{ id: 'point:b', name: 'จุด B' }
		];
		const onsubmit = await render(campaign('point:b'));
		await type('edit-item-target', '120');

		submit().click();
		await settle();

		expect(toastError).not.toHaveBeenCalled();
		expect(text('edit-item-drop-off-point-error')).toBe('');
		expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining({ dropOffPointId: 'point:b' }));
	});
});
