import { describe, it, expect } from 'vitest';
import {
	hasVolunteerAccount,
	volunteerAccessStatus,
	type VolunteerAccount
} from './volunteer-access-status';

const vol = { _id: 'V-011', user_name: 'a@x.com' };
const account = (over: Partial<VolunteerAccount> = {}): VolunteerAccount => ({
	volunteer_id: 'V-011',
	name: 'a@x.com',
	active: true,
	grants: [],
	permanent_roles: [],
	...over
});

describe('volunteerAccessStatus', () => {
	it('lists a grant with its expiry and a permanent role without one', () => {
		const s = volunteerAccessStatus(vol, [
			account({
				grants: [
					{
						role: 'distribution_staff',
						expires_at: '2026-11-03T16:59:59.999Z',
						granted_by: 'coord@x.com'
					}
				],
				permanent_roles: ['registration_staff']
			})
		]);
		expect(s).toEqual({
			kind: 'active',
			loginName: 'a@x.com',
			roles: [
				{ role: 'registration_staff', label: 'เจ้าหน้าที่ลงทะเบียน', expiresAt: null },
				{
					role: 'distribution_staff',
					label: 'เจ้าหน้าที่แจกจ่าย',
					expiresAt: '2026-11-03T16:59:59.999Z'
				}
			]
		});
	});

	it('is lapsed when the account holds nothing here any more', () => {
		const s = volunteerAccessStatus(vol, [account()]);
		expect(s).toEqual({ kind: 'lapsed', loginName: 'a@x.com' });
		expect(hasVolunteerAccount(s)).toBe(true);
	});

	it('returns none without an account', () => {
		const s = volunteerAccessStatus({ _id: 'V-1' }, [account({ volunteer_id: 'V-2' })]);
		expect(s).toEqual({ kind: 'none' });
		expect(hasVolunteerAccount(s)).toBe(false);
	});

	it('flags a deactivated account', () => {
		const s = volunteerAccessStatus(vol, [account({ active: false })]);
		expect(s).toEqual({ kind: 'deactivated', loginName: 'a@x.com', roles: [] });
		expect(hasVolunteerAccount(s)).toBe(true);
	});

	describe('accounts not known yet', () => {
		it('shows the account without roles when the profile has user_name', () => {
			expect(volunteerAccessStatus(vol, undefined)).toEqual({
				kind: 'active',
				loginName: 'a@x.com',
				roles: null
			});
		});
		it('shows none without user_name', () => {
			expect(volunteerAccessStatus({ _id: 'V-1', user_name: null }, undefined)).toEqual({
				kind: 'none'
			});
		});
	});
});
