// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { SubStorageItem, SubStorageType } from '../domain/schema';
import Harness from './__fixtures__/storage-points-harness.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

const POINT = {
	id: 'p1',
	name: 'คลัง 1',
	area_m2: null,
	accepts_donations: false,
	lat: null,
	lng: null,
	location_note: null
};

async function render(types: SubStorageType[], over: Partial<SubStorageItem> = {}) {
	instance = mount(Harness, {
		target: document.body,
		props: { points: [{ ...POINT, types, ...over }] }
	});
	flushSync();
	await tick();
	flushSync();
}

const chip = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]')].find(
		(b) => b.textContent?.trim() === label
	)!;
const storedTypes = () =>
	JSON.parse(document.body.querySelector('[data-testid="types"]')!.textContent!)[0];

async function click(label: string) {
	chip(label).click();
	flushSync();
	await tick();
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('StoragePointsSection — storage types', () => {
	it('stores types in enum order whatever the click order', async () => {
		await render(['drinking_water']);
		await click('ทั่วไป');
		await click('อาหารเด็ก');
		expect(storedTypes()).toEqual(['general', 'baby_food', 'drinking_water']);
	});

	it('refuses to clear the last type and says why', async () => {
		await render(['food_dry']);
		await click('อาหารแห้ง');
		expect(storedTypes()).toEqual(['food_dry']);
		expect(chip('อาหารแห้ง').getAttribute('data-state')).toBe('on');
		expect(toast.info).toHaveBeenCalledWith('ต้องเลือกอย่างน้อย 1 ประเภท');
	});
});

const dropOffBox = () =>
	document.body.querySelector<HTMLButtonElement>('button[aria-label="ใช้เป็นจุดรับบริจาค"]');
const pinButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('ปักหมุดตำแหน่ง')
	);
const storedPoint = () =>
	JSON.parse(document.body.querySelector('[data-testid="points"]')!.textContent!)[0];

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

describe('StoragePointsSection — donation drop-off (CR-205)', () => {
	it('hides the pin button and note until the point is ticked (FR-DP-6..8)', async () => {
		await render(['general']);
		expect(dropOffBox()).not.toBeNull();
		expect(pinButton()).toBeUndefined();
		expect(document.body.textContent).not.toContain('คำอธิบายตำแหน่งสำหรับผู้มาส่ง');

		dropOffBox()!.click();
		await settle();
		expect(storedPoint().accepts_donations).toBe(true);
		expect(pinButton()).toBeDefined();
		expect(document.body.textContent).toContain('คำอธิบายตำแหน่งสำหรับผู้มาส่ง');
		expect(document.body.textContent).toContain('ยังไม่ได้ปักหมุด');
	});

	it('keeps the pin and note when unticked (FR-DP-5)', async () => {
		await render(['general'], {
			accepts_donations: true,
			lat: 7.0086,
			lng: 100.4747,
			location_note: 'ประตู 2'
		});
		expect(document.body.textContent).toContain('7.0086, 100.4747');

		dropOffBox()!.click();
		await settle();
		expect(storedPoint()).toMatchObject({
			accepts_donations: false,
			lat: 7.0086,
			lng: 100.4747,
			location_note: 'ประตู 2'
		});
		expect(pinButton()).toBeUndefined();
	});
});
