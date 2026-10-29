// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { DonationMapPoint } from '../domain/donation-map';
import type { PublicShelterItem } from '../domain/types';
import DropOffShelterMap from './drop-off-shelter-map.svelte';

type MapProps = {
	shelters: Array<{ code: string }>;
	points: Array<{ id: string }>;
	onSelectPoint: (id: string) => void;
};

const sheltersQuery = vi.hoisted(() => ({
	data: undefined as { shelters: unknown[] } | undefined,
	isPending: false,
	isError: false,
	isSuccess: true
}));
const mapProps = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../application/queries', () => ({ usePublicShelters: () => sheltersQuery }));
vi.mock('./shelter-map.svelte', () => ({
	default: (_anchor: unknown, props: unknown) => {
		mapProps.current = props;
	}
}));

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

const point: DonationMapPoint = {
	id: 'p1',
	shelterCode: 'SH001',
	geo: { lat: 7.01, lng: 100.41 },
	label: 'โรงยิม (ประตู 2)',
	description: 'เข้าทางประตูด้านข้าง'
};

let instance: ReturnType<typeof mount> | null = null;

async function render(props: { shelterCode?: string; points?: DonationMapPoint[] } = {}) {
	instance = mount(DropOffShelterMap, {
		target: document.body,
		props: { shelterCode: 'SH001', shelterName: 'ศูนย์หาดใหญ่', ...props }
	});
	await vi.waitFor(() => flushSync());
	await tick();
	flushSync();
}

const map = () => mapProps.current as MapProps;

beforeEach(() => {
	mapProps.current = null;
	Object.assign(sheltersQuery, {
		data: {
			shelters: [publicShelter('SH001', { lat: 7.0, lng: 100.4 }), publicShelter('SH002', null)]
		},
		isError: false
	});
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('DropOffShelterMap', () => {
	it('draws the shelter pin even though it has no needs here', async () => {
		await render();
		expect(map().shelters.map((s) => s.code)).toEqual(['SH001']);
		expect(map().points).toEqual([]);
	});

	it('hands the drop-off points to the map and shows the tapped one', async () => {
		await render({ points: [point] });
		expect(map().points.map((p) => p.id)).toEqual(['p1']);

		map().onSelectPoint('p1');
		await tick();
		flushSync();
		const note = document.body.querySelector('[data-testid="drop-off-point-note"]');
		expect(note?.textContent).toContain('โรงยิม (ประตู 2)');
		expect(note?.textContent).toContain('เข้าทางประตูด้านข้าง');
	});

	it('draws no map for a shelter without coordinates', async () => {
		await render({ shelterCode: 'SH002' });
		expect(mapProps.current).toBeNull();
	});

	it('draws no map when the shelters request fails', async () => {
		Object.assign(sheltersQuery, { data: undefined, isError: true });
		await render();
		expect(mapProps.current).toBeNull();
	});
});
