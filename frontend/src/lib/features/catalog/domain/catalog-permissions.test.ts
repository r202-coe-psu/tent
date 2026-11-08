import { describe, expect, it } from 'vitest';
import { canWriteShelterRecipe, canWriteShelterCatalog } from './catalog-permissions';

describe('canWriteShelterCatalog', () => {
	it.each([['system_admin'], ['shelter_manager'], ['warehouse_staff'], ['supply_coordinator']])(
		'allows %s',
		(role) => {
			expect(canWriteShelterCatalog([role])).toBe(true);
		}
	);

	it('allows donation_staff (CR-227), flat or shelter-scoped', () => {
		expect(canWriteShelterCatalog(['donation_staff'])).toBe(true);
		expect(canWriteShelterCatalog(['shelter:SH001', 'SH001:donation_staff'])).toBe(true);
	});

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

describe('canWriteShelterRecipe', () => {
	it('allows kitchen staff of the same shelter', () => {
		expect(canWriteShelterRecipe(['shelter:SH001', 'SH001:kitchen_staff'], 'SH001')).toBe(true);
	});

	it('denies kitchen staff of another shelter', () => {
		expect(canWriteShelterRecipe(['shelter:SH001', 'SH001:kitchen_staff'], 'SH002')).toBe(false);
	});

	it('denies registration staff', () => {
		expect(canWriteShelterRecipe(['shelter:SH001', 'SH001:registration_staff'], 'SH001')).toBe(
			false
		);
	});

	it('keeps allowing system_admin', () => {
		expect(canWriteShelterRecipe(['system_admin'], 'SH001')).toBe(true);
	});

	it.each([['SH001:shelter_manager'], ['SH001:warehouse_staff']])(
		'keeps allowing %s of the same shelter',
		(role) => {
			expect(canWriteShelterRecipe(['shelter:SH001', role], 'SH001')).toBe(true);
		}
	);

	it.each([['SH001:shelter_manager'], ['SH001:warehouse_staff']])(
		'denies %s writing to another shelter',
		(role) => {
			expect(canWriteShelterRecipe(['shelter:SH001', role], 'SH002')).toBe(false);
		}
	);
});

describe('canWriteShelterRecipe for donation_staff (CR-227)', () => {
	it('stays denied: donation_staff writes items, not recipes', () => {
		expect(canWriteShelterRecipe(['shelter:SH001', 'SH001:donation_staff'], 'SH001')).toBe(false);
	});
});

describe('canWriteShelterRecipe without a shelter (central catalog)', () => {
	it('allows only system_admin', () => {
		expect(canWriteShelterRecipe(['system_admin'], undefined)).toBe(true);
		expect(canWriteShelterRecipe(['system_admin'], null)).toBe(true);
	});

	it.each([['SH001:kitchen_staff'], ['SH001:shelter_manager'], ['SH001:warehouse_staff']])(
		'denies %s',
		(role) => {
			expect(canWriteShelterRecipe(['shelter:SH001', role], undefined)).toBe(false);
		}
	);
});
