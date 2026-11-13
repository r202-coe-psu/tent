import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: vi.fn(),
	migrate: (m: unknown) => m
}));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

import { listShelterMasters } from '$lib/server/shelters.admin';
import { GET } from './+server';
import type { RequestEvent } from './$types';

const policy = (availability: 'none' | 'available', supported_vehicles: unknown[] = []) => ({
	availability,
	supported_vehicles,
	rules: [],
	rules_other: null
});
const point = (vehicles: unknown[]) => ({ id: 'p', name: 'จุด', vehicles });

const masters = [
	// car + motorcycle come from the parking points (CR-253 FR-9)
	{
		code: 'SH001',
		parking_policy: policy('available'),
		parking_points: [point([{ type: 'car', max_capacity: 30 }, { type: 'motorcycle' }])]
	},
	// legacy shelter: no points, supported_vehicles still decides (FR-10)
	{ code: 'SH002', parking_policy: policy('available', [{ type: 'boat', max_capacity: 5 }]) },
	// availability none hides the saved points (FR-11)
	{
		code: 'SH003',
		parking_policy: policy('none'),
		parking_points: [point([{ type: 'car', max_capacity: 9 }])]
	},
	// only a total parking_capacity, no vehicle type: no longer passes (Q6 / FR-22)
	{ code: 'SH004', parking_policy: policy('available'), common_areas: { parking_capacity: 40 } }
].map((m) => ({
	_id: `shelter:${m.code}`,
	name: m.code,
	// standby → no per-shelter CouchDB view reads, so only the registry is mocked
	operation_status: 'standby',
	capacity: 10,
	...m
}));

async function idsFor(query: string) {
	vi.mocked(listShelterMasters).mockResolvedValue(masters as never);
	const res = await GET({
		url: new URL(`http://localhost/api/public/v1/transparency/shelters${query}`),
		setHeaders: vi.fn()
	} as unknown as RequestEvent);
	const data = await res.json();
	return data.shelters.map((s: { id: string }) => s.id);
}

describe('GET /api/public/v1/transparency/shelters — parking filters (CR-253)', () => {
	it('parking_car keeps shelters whose points take cars, drops none / total-only ones', async () => {
		expect(await idsFor('?parking_car=on')).toEqual(['shelter:SH001']);
	});
	it('parking_motorcycle reads the points too', async () => {
		expect(await idsFor('?parking_motorcycle=on')).toEqual(['shelter:SH001']);
	});
	it('parking_boat still reads the legacy policy for a shelter without points', async () => {
		expect(await idsFor('?parking_boat=on')).toEqual(['shelter:SH002']);
	});
});
