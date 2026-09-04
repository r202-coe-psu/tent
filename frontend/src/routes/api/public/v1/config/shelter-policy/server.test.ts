import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn()
}));

import { findMasterByCode } from '$lib/server/shelters.admin';
import { GET } from './+server';
import type { RequestEvent } from './$types';

const findMasterByCodeMock = vi.mocked(findMasterByCode);

function makeEvent(shelter?: string): RequestEvent {
	const url = new URL('http://localhost/api/public/v1/config/shelter-policy');
	if (shelter) url.searchParams.set('shelter', shelter);
	return { url } as unknown as RequestEvent;
}

describe('GET /api/public/v1/config/shelter-policy', () => {
	beforeEach(() => {
		findMasterByCodeMock.mockReset();
	});

	it('returns default false flags when no shelter query param is provided', async () => {
		const res = await GET(makeEvent());
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.feature_flags).toEqual({
			allow_pets: false,
			allow_assets: false,
			allow_vehicles: false
		});
	});

	it('returns 404 when shelter is not found', async () => {
		findMasterByCodeMock.mockResolvedValue(null);
		const res = await GET(makeEvent('UNKNOWN'));
		expect(res.status).toBe(404);
		const data = await res.json();
		expect(data.feature_flags.allow_pets).toBe(false);
	});

	it('returns feature flags and policies when shelter exists', async () => {
		findMasterByCodeMock.mockResolvedValue({
			_id: 'shelter:01JABC',
			code: 'SH001',
			name: 'ศูนย์พักพิงเทศบาล',
			feature_flags: {
				allow_pets: true,
				allow_assets: true,
				allow_vehicles: false
			},
			admission_policy: {
				pet_policy: { policy: 'conditional', categories: [{ category: 'dog' }] }
			},
			luggage_policy: {
				limitation: 'limited',
				rules: ['valuables_declaration']
			},
			parking_policy: {
				availability: 'none'
			}
		} as never);

		const res = await GET(makeEvent('SH001'));
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.code).toBe('SH001');
		expect(data.feature_flags).toEqual({
			allow_pets: true,
			allow_assets: true,
			allow_vehicles: false
		});
		expect(data.admission_policy?.pet_policy?.policy).toBe('conditional');
		expect(data.luggage_policy?.limitation).toBe('limited');
		expect(data.parking_policy?.availability).toBe('none');
	});
});
