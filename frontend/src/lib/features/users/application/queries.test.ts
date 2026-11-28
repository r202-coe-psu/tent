import { describe, expect, it } from 'vitest';
import { usersKeys } from './queries';

describe('usersKeys (#477)', () => {
	it('keys the user list by the shelter it was fetched for', () => {
		expect(usersKeys.list('SH001')).not.toEqual(usersKeys.list('SH002'));
		expect(usersKeys.list(undefined)).toEqual(usersKeys.list(null));
	});

	it('keeps every list under the shared prefix that mutations invalidate', () => {
		expect(usersKeys.list('SH002').slice(0, usersKeys.all.length)).toEqual([...usersKeys.all]);
	});
});
