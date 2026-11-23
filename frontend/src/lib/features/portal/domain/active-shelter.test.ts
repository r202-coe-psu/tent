import { describe, expect, it } from 'vitest';
import { resolveActiveShelter } from './active-shelter';
import { filterPortalMenu } from './portal-menu';

const base = {
	current: undefined,
	currentProvisional: false,
	listLoaded: true,
	allowedCodes: [] as string[],
	userShelterCodes: [] as string[],
	isSystemAdmin: false
};
const settled = (code: string | undefined) => ({ code, provisional: false });
const provisional = (code: string) => ({ code, provisional: true });

describe('resolveActiveShelter', () => {
	it('keeps the current shelter when the user may use it', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH027',
				allowedCodes: ['SH001', 'SH027'],
				userShelterCodes: ['SH001', 'SH027']
			})
		).toEqual(settled('SH027'));
	});

	it('replaces a leftover shelter the user has no role in', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH001',
				allowedCodes: ['SH027'],
				userShelterCodes: ['SH027']
			})
		).toEqual(settled('SH027'));
	});

	it('follows the roles before the list loads, without remembering the guess (#1473, W1)', () => {
		expect(
			resolveActiveShelter({
				...base,
				listLoaded: false,
				current: 'SH001',
				userShelterCodes: ['SH027']
			})
		).toEqual(provisional('SH027'));
	});

	it('re-picks in list order once the list loads, like the navbar (W1)', () => {
		// roles list SH002 first; the registry lists SH001 first.
		const before = resolveActiveShelter({
			...base,
			listLoaded: false,
			userShelterCodes: ['SH002', 'SH001']
		});
		expect(before).toEqual(provisional('SH002'));
		const after = resolveActiveShelter({
			...base,
			current: before.code,
			currentProvisional: true,
			allowedCodes: ['SH001', 'SH002'],
			userShelterCodes: ['SH002', 'SH001']
		});
		expect(after).toEqual(settled('SH001'));
	});

	it('settles on the roles when the loaded list has none of the user shelters', () => {
		// allowedCodes is the list narrowed to the user's roles, so it is empty here.
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH999',
				allowedCodes: [],
				userShelterCodes: ['SH027']
			})
		).toEqual(settled('SH027'));
	});

	it('keeps a remembered shelter that the roles allow while the list is still loading', () => {
		expect(
			resolveActiveShelter({
				...base,
				listLoaded: false,
				current: 'SH002',
				userShelterCodes: ['SH001', 'SH002']
			})
		).toEqual(settled('SH002'));
	});

	it('forgets the remembered shelter when no shelter role is left (W2)', () => {
		expect(resolveActiveShelter({ ...base, current: 'SH001', allowedCodes: ['SH001'] })).toEqual(
			settled(undefined)
		);
		expect(resolveActiveShelter({ ...base, listLoaded: false, current: 'SH001' })).toEqual(
			settled(undefined)
		);
	});

	it('leaves a system admin as is until the list loads', () => {
		expect(
			resolveActiveShelter({ ...base, listLoaded: false, current: 'SH001', isSystemAdmin: true })
		).toEqual(settled('SH001'));
		expect(resolveActiveShelter({ ...base, listLoaded: false, isSystemAdmin: true })).toEqual(
			settled(undefined)
		);
	});

	it('lets a system admin keep any listed shelter', () => {
		expect(
			resolveActiveShelter({
				...base,
				current: 'SH001',
				allowedCodes: ['SH001', 'SH027'],
				isSystemAdmin: true
			})
		).toEqual(settled('SH001'));
	});
});

describe('portal menu after a Google login with a leftover shelter (#1473)', () => {
	const roles = ['shelter:SH027', 'SH027:registration_staff'];
	const features = { medicalScreening: false };

	it('is empty for the leftover shelter and full once the shelter follows the roles', () => {
		const stale = filterPortalMenu({ roles, shelterCode: 'SH001', features });
		expect(stale).toEqual([]);

		const { code: shelterCode } = resolveActiveShelter({
			current: 'SH001',
			currentProvisional: false,
			listLoaded: false,
			allowedCodes: [],
			userShelterCodes: ['SH027'],
			isSystemAdmin: false
		});
		const fixed = filterPortalMenu({ roles, shelterCode, features });
		expect(fixed.map((d) => d.id)).toContain('registration');
	});
});
