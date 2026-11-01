// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import CreateCampaignForm from './create-campaign-form.svelte';

const points = vi.hoisted(() => ({
	list: [] as { id: string; name: string }[],
	loaded: true
}));

vi.mock('$lib/features/operations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/operations')>()),
	useDonationPoints: () => ({
		get points() {
			return points.list;
		},
		get isLoaded() {
			return points.loaded;
		}
	})
}));
vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => ({ data: [], isPending: false }) }));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () => ({ data: [], isPending: false }),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(CreateCampaignForm, {
		target: document.body,
		props: { onclose: vi.fn(), onsubmit: vi.fn() }
	});
	flushSync();
	await tick();
}

const submit = () =>
	document.body.querySelector('button[type="submit"]') as HTMLButtonElement | null;
const pointLabel = () => document.body.textContent?.includes('จุดรับบริจาค') ?? false;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	points.list = [];
	points.loaded = true;
});

describe('create campaign form drop-off point (FR-AP-2, 2a, 3)', () => {
	it('shows no dropdown and can save when the shelter has no point', async () => {
		await render();
		expect(pointLabel()).toBe(false);
		expect(submit()?.disabled).toBe(false);
	});

	it('picks the only point for staff and can save', async () => {
		points.list = [{ id: 'p-gym', name: 'โรงยิม' }];
		await render();
		expect(document.body.textContent).toContain('โรงยิม');
		expect(submit()?.disabled).toBe(false);
	});

	it('blocks save until a point is chosen when there are several', async () => {
		points.list = [
			{ id: 'p-gym', name: 'โรงยิม' },
			{ id: 'p-med', name: 'ห้องพยาบาล' }
		];
		await render();
		expect(pointLabel()).toBe(true);
		expect(document.body.textContent).toContain('เลือกจุดรับบริจาค');
		expect(submit()?.disabled).toBe(true);
	});

	it('blocks save until the shelter doc has loaded', async () => {
		points.loaded = false;
		await render();
		expect(submit()?.disabled).toBe(true);
	});
});
