// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { DonationMapPoint, DonationNeedsEntry } from '../domain/donation-map';
import type { PublicShelterItem } from '../domain/types';
import DonationShelterPicker from './donation-shelter-picker.svelte';

type MapProps = {
	shelters: Array<{ id: string; code: string; geo: unknown }>;
	points: Array<{ id: string }>;
	selectedId: string | null;
	onSelectShelter: (id: string) => void;
	onSelectPoint: (id: string) => void;
	onLoadError: () => void;
};

const sheltersQuery = vi.hoisted(() => ({
	data: undefined as { shelters: unknown[] } | undefined,
	isPending: false,
	isError: false,
	isSuccess: true
}));
const mapProps = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../application/queries', () => ({ usePublicShelters: () => sheltersQuery }));
// WebGL does not exist in happy-dom; the stub records what the picker hands the map.
vi.mock('./shelter-map.svelte', () => ({
	default: (_anchor: unknown, props: unknown) => {
		mapProps.current = props;
	}
}));

const needs: DonationNeedsEntry[] = [
	{
		code: 'SH001',
		name: 'ศูนย์หาดใหญ่',
		needs: [
			{ item_id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', qty_needed: '50', urgency: 'critical' }
		]
	},
	{ code: 'SH002', name: 'ศูนย์สงขลา', needs: [] },
	{ code: 'SH003', name: 'ศูนย์ไม่มีพิกัด', needs: [] }
];

function publicShelter(code: string, geo: PublicShelterItem['geo']): PublicShelterItem {
	return {
		code,
		name: code,
		site_kind: 'evacuation_center',
		status: 'open',
		capacity: 10,
		geo,
		province: 'สงขลา',
		accepts_pre_registration: true,
		updated_at: '2026-10-26T00:00:00Z'
	};
}

const onSelect = vi.fn();
let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	flushSync();
}

async function render(
	props: {
		selectedCode?: string;
		lockedCode?: string | null;
		pointsByShelter?: Record<string, DonationMapPoint[]>;
	} = {}
) {
	instance = mount(DonationShelterPicker, {
		target: document.body,
		props: {
			needs,
			selectedCode: '',
			labelledBy: 'label',
			onSelect,
			...props
		}
	});
	await settle();
}

const map = () => mapProps.current as MapProps;
const radios = () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const card = () => document.body.querySelector('[data-testid="donation-shelter-card"]');
const chooseButton = () =>
	document.body.querySelector<HTMLButtonElement>('[data-testid="donation-shelter-choose"]');

beforeEach(() => {
	vi.clearAllMocks();
	mapProps.current = null;
	Object.assign(sheltersQuery, {
		data: {
			shelters: [
				publicShelter('SH001', { lat: 7.0, lng: 100.4 }),
				publicShelter('SH002', { lat: 7.1, lng: 100.5 }),
				publicShelter('SH003', null)
			]
		},
		isPending: false,
		isError: false,
		isSuccess: true
	});
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('DonationShelterPicker', () => {
	it('lists every shelter that takes donations, with or without coordinates', async () => {
		await render();
		expect(radios().map((r) => r.value)).toEqual(['SH001', 'SH002', 'SH003']);
		expect(document.body.textContent).toContain('ไม่มีพิกัดบนแผนที่');
	});

	it('gives the map only the shelters that have coordinates', async () => {
		await render();
		expect(map().shelters.map((s) => s.code)).toEqual(['SH001', 'SH002']);
	});

	it('picks a shelter from the list', async () => {
		await render();
		radios()[1].click();
		await settle();
		expect(onSelect).toHaveBeenCalledExactlyOnceWith('SH002', 'ศูนย์สงขลา');
	});

	it('opens a card on a pin tap without choosing the shelter yet', async () => {
		await render();
		expect(card()).toBeNull();

		map().onSelectShelter('SH001');
		await settle();

		expect(card()?.textContent).toContain('ศูนย์หาดใหญ่');
		expect(card()?.textContent).toContain('ข้าวสาร');
		expect(onSelect).not.toHaveBeenCalled();
		expect(map().selectedId).toBe('SH001');

		chooseButton()?.click();
		await settle();
		expect(onSelect).toHaveBeenCalledExactlyOnceWith('SH001', 'ศูนย์หาดใหญ่');
	});

	it('shows the chosen state instead of the button for the selected shelter', async () => {
		await render({ selectedCode: 'SH001' });
		expect(card()?.textContent).toContain('เลือกศูนย์นี้แล้ว');
		expect(chooseButton()).toBeNull();
	});

	it('offers only the locked shelter and does not let it change', async () => {
		await render({ selectedCode: 'SH002', lockedCode: 'SH002' });
		expect(radios().map((r) => [r.value, r.disabled, r.checked])).toEqual([['SH002', true, true]]);
		expect(map().shelters.map((s) => s.code)).toEqual(['SH002']);
		expect(map().selectedId).toBe('SH002');
	});

	it('opens the owning shelter card, with the point, when a drop-off pin is tapped', async () => {
		await render({
			pointsByShelter: {
				SH002: [
					{
						id: 'p1',
						shelterCode: 'SH002',
						geo: { lat: 7.11, lng: 100.51 },
						label: 'โรงจอดรถด้านหลัง',
						description: 'เข้าทางประตู 2'
					}
				]
			}
		});
		expect(map().points.map((p) => p.id)).toEqual(['p1']);

		map().onSelectPoint('p1');
		await settle();

		expect(card()?.textContent).toContain('ศูนย์สงขลา');
		expect(card()?.textContent).toContain('โรงจอดรถด้านหลัง');
		expect(card()?.textContent).toContain('เข้าทางประตู 2');
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('ignores a tap on a pin it does not know', async () => {
		await render();
		map().onSelectPoint('nope');
		await settle();
		expect(card()).toBeNull();
	});

	it('drops the map but keeps the list when the shelters request fails', async () => {
		Object.assign(sheltersQuery, { data: undefined, isError: true, isSuccess: false });
		await render();
		expect(mapProps.current).toBeNull();
		expect(document.body.textContent).toContain('แผนที่ใช้งานไม่ได้ในตอนนี้');
		expect(radios().map((r) => r.value)).toEqual(['SH001', 'SH002', 'SH003']);
		expect(document.body.textContent).not.toContain('ไม่มีพิกัดบนแผนที่');
	});

	it('drops the map but keeps the list when the map cannot start', async () => {
		await render();
		map().onLoadError();
		await settle();
		expect(document.body.querySelector('[data-testid="donation-shelter-map"]')).toBeNull();
		expect(document.body.textContent).toContain('แผนที่ใช้งานไม่ได้ในตอนนี้');
		expect(radios()).toHaveLength(3);
	});
});
