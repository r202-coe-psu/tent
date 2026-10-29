// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte';
import type { DonationNeedsEntry } from '../domain/donation-map';
import type { PublicShelterItem } from '../domain/types';
import DonationNeedsMap from './donation-needs-map.svelte';

type MapProps = {
	shelters: Array<{ id: string; code: string; pin: { label: string; fill: string } }>;
	points: Array<{ id: string; shelterCode: string }>;
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
const shelterQuery = vi.hoisted(() => ({
	data: undefined as { donation_points?: unknown[] } | undefined,
	codes: [] as Array<string | null | undefined>
}));
const mapProps = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../application/queries', () => ({
	usePublicShelters: () => sheltersQuery,
	usePublicShelter: (code: () => string | null | undefined) => {
		shelterQuery.codes.push(code());
		return shelterQuery;
	}
}));
// WebGL does not exist in happy-dom; the stub records what the component hands the map.
vi.mock('./shelter-map.svelte', () => ({
	default: (_anchor: unknown, props: unknown) => {
		mapProps.current = props;
	}
}));

const board: DonationNeedsEntry[] = [
	{ code: 'SH001', name: 'ศูนย์หาดใหญ่', needs: [] },
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
const cardSnippet = createRawSnippet((shelter: () => { name: string }) => ({
	render: () => `<p data-testid="card">${shelter().name}</p>`
}));
let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	flushSync();
}

async function render(
	props: { shelters?: DonationNeedsEntry[]; selectedCode?: string | null } = {}
) {
	instance = mount(DonationNeedsMap, {
		target: document.body,
		props: { shelters: board, selectedCode: null, onSelect, card: cardSnippet, ...props }
	});
	await settle();
}

const map = () => mapProps.current as MapProps;
const cardText = () => document.body.querySelector('[data-testid="card"]')?.textContent ?? null;

beforeEach(() => {
	vi.clearAllMocks();
	mapProps.current = null;
	Object.assign(shelterQuery, { data: undefined, codes: [] });
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

describe('DonationNeedsMap', () => {
	it('pins only the shelters that have coordinates', async () => {
		await render();
		expect(map().shelters.map((s) => s.code)).toEqual(['SH001', 'SH002']);
		expect(cardText()).toBeNull();
	});

	it("numbers each pin by its card's place on the board, counting shelters without a pin", async () => {
		await render({ shelters: [board[2], board[0], board[1]] });
		expect(map().shelters.map((s) => [s.code, s.pin.label])).toEqual([
			['SH001', '2'],
			['SH002', '3']
		]);
	});

	it("colours a pin by the shelter's most urgent open need", async () => {
		await render({
			shelters: [
				{
					code: 'SH001',
					name: 'ศูนย์หาดใหญ่',
					needs: [
						{ item_id: 'item:a', qty_needed: 1, urgency: 'normal' },
						{ item_id: 'item:b', qty_needed: 1, urgency: 'critical' }
					]
				},
				{
					code: 'SH002',
					name: 'ศูนย์สงขลา',
					needs: [{ item_id: 'item:c', qty_needed: 1, urgency: 'critical', status: 'closed' }]
				}
			]
		});
		expect(map().shelters.map((s) => s.pin.fill)).toEqual(['#DC2626', '#047857']);
	});

	it('reports a pin tap to the board', async () => {
		await render();
		map().onSelectShelter('SH002');
		expect(onSelect).toHaveBeenCalledExactlyOnceWith('SH002');
	});

	it('renders the card snippet for the selected shelter and lets the donor close it', async () => {
		await render({ selectedCode: 'SH002' });
		expect(cardText()).toBe('ศูนย์สงขลา');
		expect(map().selectedId).toBe('SH002');

		document.body.querySelector<HTMLButtonElement>('button[aria-label]')?.click();
		expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('draws no drop-off pins before a shelter is picked', async () => {
		await render();
		expect(map().points).toEqual([]);
		expect(shelterQuery.codes).toEqual([null]);
	});

	it("pins only the picked shelter's drop-off points, read from its detail (CR-205 AC-12)", async () => {
		shelterQuery.data = {
			donation_points: [
				{ id: 'p1', name: 'โรงยิม', geo: { lat: 7.01, lng: 100.41 }, location_note: 'ประตู 2' },
				{ id: 'p2', name: 'ห้องพยาบาล', geo: { lat: 7.02, lng: 100.42 } }
			]
		};
		await render({ selectedCode: 'SH002' });
		expect(shelterQuery.codes).toEqual(['SH002']);
		expect(map().points.map((p) => [p.id, p.shelterCode])).toEqual([
			['p1', 'SH002'],
			['p2', 'SH002']
		]);

		map().onSelectPoint('p1');
		await settle();
		const note = document.body.querySelector('[data-testid="donation-needs-map-point-note"]');
		expect(note?.textContent).toContain('โรงยิม');
		expect(note?.textContent).toContain('ประตู 2');
	});

	it('adds no drop-off pin for a picked shelter without ticked points', async () => {
		shelterQuery.data = { donation_points: [] };
		await render({ selectedCode: 'SH002' });
		expect(map().points).toEqual([]);
	});

	it('shows no card for a shelter that is not on the map', async () => {
		await render({ selectedCode: 'SH003' });
		expect(cardText()).toBeNull();
	});

	it('shows no card once the selected shelter leaves the board', async () => {
		await render({ shelters: [board[0]], selectedCode: 'SH002' });
		expect(cardText()).toBeNull();
	});

	it('drops the map when the shelters request fails', async () => {
		Object.assign(sheltersQuery, { data: undefined, isError: true, isSuccess: false });
		await render();
		expect(mapProps.current).toBeNull();
		expect(document.body.textContent).toContain('แผนที่ใช้ไม่ได้ในตอนนี้');
	});

	it('drops the map when it cannot start', async () => {
		await render();
		map().onLoadError();
		await settle();
		expect(document.body.querySelector('[data-testid="donation-needs-map"]')).toBeNull();
		expect(document.body.textContent).toContain('แผนที่ใช้ไม่ได้ในตอนนี้');
	});

	it('renders nothing when no shelter has coordinates', async () => {
		await render({ shelters: [board[2]] });
		expect(mapProps.current).toBeNull();
		expect(document.body.textContent).toBe('');
	});
});
