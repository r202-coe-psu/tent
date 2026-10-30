// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { PublicDonationPoint } from '../domain/types';
import type { PublicShelterItem } from '../domain/types';
import DropOffShelterMap from './drop-off-shelter-map.svelte';

type MapProps = {
	shelters: Array<{ code: string }>;
	points: Array<{ id: string }>;
	pointFocus: { pointId: string; zoom: boolean; seq: number } | null;
	onSelectPoint: (id: string) => void;
};

const sheltersQuery = vi.hoisted(() => ({
	data: undefined as { shelters: unknown[] } | undefined,
	isPending: false,
	isError: false,
	isSuccess: true
}));
const shelterQuery = vi.hoisted(() => ({
	data: undefined as { donation_points?: unknown[] } | undefined,
	code: null as string | null | undefined
}));
const mapProps = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../application/queries', () => ({
	usePublicShelters: () => sheltersQuery,
	usePublicShelter: (code: () => string | null | undefined) => {
		shelterQuery.code = code();
		return shelterQuery;
	}
}));
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

const point: PublicDonationPoint = {
	id: 'p1',
	name: 'โรงยิม (ประตู 2)',
	geo: { lat: 7.01, lng: 100.41 },
	location_note: 'เข้าทางประตูด้านข้าง'
};

let instance: ReturnType<typeof mount> | null = null;

async function render(
	props: {
		shelterCode?: string;
		focus?: { pointId: string; zoom: boolean; seq: number } | null;
		focusNote?: string | null;
		onFocusPoint?: (pointId: string) => void;
	} = {}
) {
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
	Object.assign(shelterQuery, { data: undefined, code: null });
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

	it("pins the locked shelter's drop-off points from its detail (CR-205 FR-DP-18)", async () => {
		shelterQuery.data = { donation_points: [point] };
		await render();
		expect(shelterQuery.code).toBe('SH001');
		expect(map().points.map((p) => p.id)).toEqual(['p1']);
	});

	it('names the point in focus under the map, with what it is used for', async () => {
		shelterQuery.data = { donation_points: [point] };
		await render({ focus: { pointId: 'p1', zoom: false, seq: 1 }, focusNote: 'ใช้กับ: ข้าวสาร' });

		const note = document.body.querySelector('[data-testid="drop-off-point-note"]');
		expect(note?.textContent).toContain('โรงยิม (ประตู 2)');
		expect(note?.textContent).toContain('เข้าทางประตูด้านข้าง');
		expect(note?.textContent).toContain('ใช้กับ: ข้าวสาร');
		expect(note?.closest('[role="status"]')).not.toBeNull();
	});

	// CR-206 FR-MP-9 — the tapped point becomes the default drop-off point of every line.
	it('reports a point tap to the booking form', async () => {
		shelterQuery.data = { donation_points: [point] };
		const onFocusPoint = vi.fn();
		await render({ onFocusPoint });

		map().onSelectPoint('p1');
		expect(onFocusPoint).toHaveBeenCalledWith('p1');
	});

	it('hands the focus request to the map as is', async () => {
		shelterQuery.data = { donation_points: [point] };
		const focus = { pointId: 'p1', zoom: true, seq: 3 };
		await render({ focus });

		expect(map().pointFocus).toEqual(focus);
	});

	it('keeps the shelter pin alone when the detail has no points or fails', async () => {
		shelterQuery.data = { donation_points: [] };
		await render();
		expect(map().points).toEqual([]);
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
