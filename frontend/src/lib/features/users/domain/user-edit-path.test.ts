import { describe, expect, it } from 'vitest';
import {
	safeReturnPath,
	userEditHref,
	usersListBaseFromPathname,
	withUsersView
} from './user-edit-path';

describe('usersListBaseFromPathname', () => {
	it('uses the portal list under system management', () => {
		expect(usersListBaseFromPathname('/portal/system-management/users')).toBe(
			'/portal/system-management/users'
		);
		expect(usersListBaseFromPathname('/portal/system-management/shelters/edit/SH001')).toBe(
			'/portal/system-management/users'
		);
	});

	it('uses the back-office list otherwise', () => {
		expect(usersListBaseFromPathname('/back-office/users')).toBe('/back-office/users');
		expect(usersListBaseFromPathname('/back-office/shelters/edit/SH001')).toBe(
			'/back-office/users'
		);
	});
});

describe('userEditHref', () => {
	it('encodes the username and optional return path', () => {
		expect(userEditHref('/back-office/users', '0812345678')).toBe('/back-office/users/0812345678');
		expect(userEditHref('/back-office/users', 'user/name', '/back-office/users')).toBe(
			'/back-office/users/user%2Fname?from=%2Fback-office%2Fusers'
		);
	});
});

describe('safeReturnPath', () => {
	it('accepts same-origin relative paths only', () => {
		expect(safeReturnPath('/back-office/users', '/fallback')).toBe('/back-office/users');
		expect(safeReturnPath('/back-office/shelters/edit/SH001?view=users', '/fallback')).toBe(
			'/back-office/shelters/edit/SH001?view=users'
		);
		expect(safeReturnPath('//evil.example', '/fallback')).toBe('/fallback');
		expect(safeReturnPath('https://evil.example', '/fallback')).toBe('/fallback');
		expect(safeReturnPath(null, '/fallback')).toBe('/fallback');
	});
});

describe('withUsersView', () => {
	it('leaves a dedicated users list unchanged', () => {
		expect(withUsersView('/back-office/users', '')).toBe('/back-office/users');
	});

	it('marks an embedded list so the users pane can be restored', () => {
		expect(withUsersView('/back-office/shelters/edit/SH001', '')).toBe(
			'/back-office/shelters/edit/SH001?view=users'
		);
	});
});
