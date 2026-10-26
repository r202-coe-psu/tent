import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceFetch = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/service', () => ({ serviceFetch }));

import { listShelterStaff } from './staff-directory.api';

describe('listShelterStaff', () => {
	beforeEach(() => {
		serviceFetch.mockReset().mockResolvedValue([]);
	});

	it('omits the query when no capabilities are given', async () => {
		await listShelterStaff('SH001');
		expect(serviceFetch).toHaveBeenCalledWith('/api/v1/shelters/SH001/staff');
	});

	it('appends capabilities as a comma-separated param', async () => {
		await listShelterStaff('SH001', ['security_officer', 'shelter_manager']);
		expect(serviceFetch).toHaveBeenCalledWith(
			'/api/v1/shelters/SH001/staff?capabilities=security_officer%2Cshelter_manager'
		);
	});
});
