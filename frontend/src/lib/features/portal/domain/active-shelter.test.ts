import { describe, expect, it } from 'vitest';
import { resolveActiveShelter } from './active-shelter';
import { filterPortalMenu } from './portal-menu';

const base = { current: undefined, allowedCodes: [], userShelterCodes: [], isSystemAdmin: false };

describe('resolveActiveShelter', () => {
	it('keeps the current shelter when the user may use it', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH027',
				allowedCodes: ['SH001', 'SH027'],
				userShelterCodes: ['SH001', 'SH027']
			})
		).toBe('SH027');
	});

	it('replaces a leftover shelter the user has no role in', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH001',
				allowedCodes: ['SH027'],
				userShelterCodes: ['SH027']
			})
		).toBe('SH027');
	});

	it('falls back to the roles when the shelter list has not loaded (#1473)', () => {
		expect(resolveActiveShelter({ ...base, current: 'SH001', userShelterCodes: ['SH027'] })).toBe(
			'SH027'
		);
	});

	it('falls back to the roles when the list does not contain the user shelter', () => {
		// allowedCodes is the list narrowed to the user's roles, so it is empty here.
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH999',
				allowedCodes: [],
				userShelterCodes: ['SH027']
			})
		).toBe('SH027');
	});

	it('keeps a current shelter that the roles allow while the list is missing', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH002',
				userShelterCodes: ['SH001', 'SH002']
			})
		).toBe('SH002');
	});

	it('picks the first role shelter when nothing is selected', () => {
		expect(resolveActiveShelter({ ...base, userShelterCodes: ['SH027', 'SH028'] })).toBe('SH027');
	});

	it('chooses nothing without roles, and for a system admin before the list loads', () => {
		expect(resolveActiveShelter({ ...base, current: 'SH001' })).toBeUndefined();
		expect(
			resolveActiveShelter({ ...base, current: 'SH001', isSystemAdmin: true })
		).toBeUndefined();
	});

	it('lets a system admin keep any listed shelter', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH001',
				allowedCodes: ['SH001', 'SH027'],
				isSystemAdmin: true
			})
		).toBe('SH001');
	});
});

describe('portal menu after a Google login with a leftover shelter (#1473)', () => {
	const roles = ['shelter:SH027', 'SH027:registration_staff'];
	const features = { medicalScreening: false };

	it('is empty for the leftover shelter and full once the shelter follows the roles', () => {
		const stale = filterPortalMenu({ roles, shelterCode: 'SH001', features });
		expect(stale).toEqual([]);

		const shelterCode = resolveActiveShelter({
			current: 'SH001',
			allowedCodes: [],
			userShelterCodes: ['SH027'],
			isSystemAdmin: false
		});
		const fixed = filterPortalMenu({ roles, shelterCode, features });
		expect(fixed.map((d) => d.id)).toContain('registration');
	});
});
