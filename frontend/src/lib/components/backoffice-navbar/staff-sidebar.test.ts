import { describe, expect, it } from 'vitest';
import { showsStaffMobileBar, showsStaffSidebar, staffSidebarClass } from './staff-sidebar';

const SA = ['system_admin'];
const SM = ['shelter:SH001', 'SH001:shelter_manager'];
const REGISTRATION = ['shelter:SH001', 'SH001:registration_staff'];

describe('showsStaffSidebar (#1517)', () => {
	it.each(['/portal', '/me', '/onsite', '/onsite/registration/new'])(
		'gives a system admin the sidebar on %s',
		(path) => {
			expect(showsStaffSidebar(path, SA, 'SH001')).toBe(true);
		}
	);

	it('gives the manager of the selected shelter the sidebar', () => {
		expect(showsStaffSidebar('/portal', SM, 'SH001')).toBe(true);
	});

	it('does not give a manager of another shelter the sidebar', () => {
		expect(showsStaffSidebar('/portal', SM, 'SH002')).toBe(false);
	});

	it('leaves every other role as before', () => {
		expect(showsStaffSidebar('/portal', REGISTRATION, 'SH001')).toBe(false);
		expect(showsStaffSidebar('/onsite/distribution', REGISTRATION, 'SH001')).toBe(false);
	});

	it('leaves pages that already have a sidebar of their own alone', () => {
		expect(showsStaffSidebar('/back-office/volunteers', SA, 'SH001')).toBe(false);
		expect(showsStaffSidebar('/system-management/shelters', SA, 'SH001')).toBe(false);
	});

	it('does not match a path that only starts with the same letters', () => {
		expect(showsStaffSidebar('/portalx', SA, 'SH001')).toBe(false);
		expect(showsStaffSidebar('/message', SA, 'SH001')).toBe(false);
	});
});

describe('showsStaffMobileBar', () => {
	it('keeps the top of /onsite for the page on phones, and shows the bar elsewhere', () => {
		expect(showsStaffMobileBar('/onsite')).toBe(false);
		expect(showsStaffMobileBar('/onsite/registration')).toBe(false);
		expect(showsStaffMobileBar('/portal')).toBe(true);
		expect(showsStaffMobileBar('/me')).toBe(true);
	});
});

describe('staffSidebarClass', () => {
	it('starts below the app bar on /portal and /me, for the sidebar and the phone bar', () => {
		for (const path of ['/portal', '/me']) {
			expect(staffSidebarClass(path)).toContain('[&>aside]:top-14');
			expect(staffSidebarClass(path)).toContain('[&>div]:top-14');
		}
	});

	it('starts at the very top on /onsite, which has no app bar', () => {
		expect(staffSidebarClass('/onsite')).toContain('[&>aside]:top-0');
		expect(staffSidebarClass('/onsite/registration')).not.toContain('top-14');
	});
});
