import { describe, expect, it } from 'vitest';
import { canWriteShelterCatalog } from './catalog-permissions';

describe('canWriteShelterCatalog', () => {
	it.each([['system_admin'], ['shelter_manager'], ['warehouse_staff'], ['supply_coordinator']])(
		'allows %s',
		(role) => {
			expect(canWriteShelterCatalog([role])).toBe(true);
		}
	);

	it('allows a shelter-scoped warehouse capability', () => {
		expect(canWriteShelterCatalog(['SH001:warehouse_staff'])).toBe(true);
	});

	it.each([['registration_staff'], ['kitchen_staff'], ['volunteer']])('denies %s', (role) => {
		expect(canWriteShelterCatalog([role])).toBe(false);
	});

	it('denies an empty role list', () => {
		expect(canWriteShelterCatalog([])).toBe(false);
	});
});
