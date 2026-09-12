import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/thailand-location', () => ({
	listProvinces: vi.fn(),
	listDistricts: vi.fn(),
	listSubdistricts: vi.fn()
}));

import { listDistricts, listProvinces, listSubdistricts } from '$lib/server/thailand-location';
import { GET } from './+server';
import type { RequestEvent } from './$types';

const provincesMock = vi.mocked(listProvinces);
const districtsMock = vi.mocked(listDistricts);
const subdistrictsMock = vi.mocked(listSubdistricts);

/** The handler only reads `url` off the event. */
function event(query: string): RequestEvent {
	return {
		url: new URL(`http://localhost/api/public/v1/config/locations${query}`)
	} as RequestEvent;
}

describe('GET /api/public/v1/config/locations', () => {
	beforeEach(() => {
		provincesMock.mockReset();
		districtsMock.mockReset();
		subdistrictsMock.mockReset();
	});

	// One handler, three shapes — which one comes back is decided by how much of
	// the จังหวัด → อำเภอ → ตำบล cascade the caller has filled in.
	it('returns provinces when nothing is selected yet', async () => {
		provincesMock.mockResolvedValue(['สงขลา', 'ปัตตานี']);

		const res = await GET(event(''));
		expect(await res.json()).toEqual({ provinces: ['สงขลา', 'ปัตตานี'] });
		expect(districtsMock).not.toHaveBeenCalled();
	});

	it('returns districts once a province is chosen', async () => {
		districtsMock.mockResolvedValue(['หาดใหญ่']);

		const res = await GET(event('?province=สงขลา'));
		expect(await res.json()).toEqual({ districts: ['หาดใหญ่'] });
		expect(districtsMock).toHaveBeenCalledWith('สงขลา');
	});

	it('returns subdistricts with their zipcode once a district is chosen', async () => {
		subdistrictsMock.mockResolvedValue([{ subdistrict: 'คอหงส์', zipcode: 90110 }]);

		const res = await GET(event('?province=สงขลา&district=หาดใหญ่'));
		expect(await res.json()).toEqual({ subdistricts: [{ subdistrict: 'คอหงส์', zipcode: 90110 }] });
		expect(subdistrictsMock).toHaveBeenCalledWith('สงขลา', 'หาดใหญ่');
	});

	// Reference data, not a gate: a failed lookup narrows the address choices but
	// must never make the booking form itself unusable.
	it('degrades to empty lists instead of failing the booking form', async () => {
		provincesMock.mockRejectedValue(new Error('read failed'));

		const res = await GET(event(''));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ provinces: [], districts: [], subdistricts: [] });
	});
});
