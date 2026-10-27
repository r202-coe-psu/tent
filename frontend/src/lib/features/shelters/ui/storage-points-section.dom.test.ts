// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { SubStorageType } from '../domain/schema';
import Harness from './__fixtures__/storage-points-harness.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

async function render(types: SubStorageType[]) {
	instance = mount(Harness, {
		target: document.body,
		props: { points: [{ id: 'p1', name: 'คลัง 1', types, area_m2: null }] }
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
