import { describe, it, expect } from 'vitest';
import { hasVolunteerAccount, volunteerAccessStatus } from './volunteer-access-status';

const vol = { _id: 'V-011', user_name: 'a@x.com' };

describe('volunteerAccessStatus', () => {
	it('reads a compound role', () => {
		const s = volunteerAccessStatus(
			vol,
			[{ name: 'a@x.com', roles: ['SH001:distribution_staff'], volunteer_id: 'V-011' }],
			'SH001'
		);
		expect(s).toEqual({
			kind: 'linked',
			loginName: 'a@x.com',
			roleLabels: ['เจ้าหน้าที่แจกจ่าย']
		});
	});

	it('reads a legacy flat role', () => {
		const s = volunteerAccessStatus(
			vol,
			[{ name: 'a@x.com', roles: ['shelter:SH001', 'registration_staff'], volunteer_id: 'V-011' }],
			'SH001'
		);
		expect(s).toMatchObject({ kind: 'linked', roleLabels: ['เจ้าหน้าที่ลงทะเบียน'] });
	});

	it('returns none without an account', () => {
		const s = volunteerAccessStatus(
			{ _id: 'V-1' },
			[{ name: 'b@x.com', roles: [], volunteer_id: 'V-2' }],
			'SH001'
		);
		expect(s).toEqual({ kind: 'none' });
		expect(hasVolunteerAccount(s)).toBe(false);
	});

	it('flags a deactivated account', () => {
		const s = volunteerAccessStatus(
			vol,
			[
				{
					name: 'a@x.com',
					roles: ['SH001:distribution_staff'],
					volunteer_id: 'V-011',
					active: false
				}
			],
			'SH001'
		);
		expect(s.kind).toBe('deactivated');
		expect(hasVolunteerAccount(s)).toBe(true);
	});

	it('has no labels when roles belong to another shelter only', () => {
		const s = volunteerAccessStatus(
			vol,
			[{ name: 'a@x.com', roles: ['SH002:distribution_staff'], volunteer_id: 'V-011' }],
			'SH001'
		);
		expect(s).toEqual({ kind: 'linked', loginName: 'a@x.com', roleLabels: [] });
	});

	it('lists multiple capabilities', () => {
		const s = volunteerAccessStatus(
			vol,
			[
				{
					name: 'a@x.com',
					roles: ['SH001:distribution_staff', 'SH001:registration_staff'],
					volunteer_id: 'V-011'
				}
			],
			'SH001'
		);
		expect(s).toMatchObject({
			kind: 'linked',
			roleLabels: expect.arrayContaining(['เจ้าหน้าที่แจกจ่าย', 'เจ้าหน้าที่ลงทะเบียน'])
		});
		expect((s as { roleLabels: string[] }).roleLabels).toHaveLength(2);
	});

	it('falls back to user_name matching when volunteer_id is missing', () => {
		const s = volunteerAccessStatus(
			vol,
			[{ name: 'a@x.com', roles: ['SH001:distribution_staff'] }],
			'SH001'
		);
		expect(s.kind).toBe('linked');
	});

	describe('accounts unavailable (non SM/SA viewer)', () => {
		it('shows linked without roles when the profile has user_name', () => {
			expect(volunteerAccessStatus(vol, undefined, 'SH001')).toEqual({
				kind: 'linked',
				loginName: 'a@x.com',
				roleLabels: null
			});
		});
		it('shows none without user_name', () => {
			expect(volunteerAccessStatus({ _id: 'V-1', user_name: null }, undefined, 'SH001')).toEqual({
				kind: 'none'
			});
		});
	});
});
