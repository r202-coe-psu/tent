import { describe, expect, it } from 'vitest';
import { visibleShelters, visibleSheltersBasic } from './shelters.remote';

const all = [{ code: 'SH001' }, { code: 'SH002' }, { code: 'SH003' }];
const codes = (list: { code: string }[]) => list.map((s) => s.code);

describe('visibleShelters', () => {
	it('shows a system admin every shelter', () => {
		expect(codes(visibleShelters(['system_admin'], all))).toEqual(['SH001', 'SH002', 'SH003']);
	});

	it('shows a single-shelter user only their shelter', () => {
		expect(codes(visibleShelters(['shelter:SH001', 'SH001:shelter_manager'], all))).toEqual([
			'SH001'
		]);
	});

	it('shows a multi-shelter manager every shelter they hold, not just the first', () => {
		const roles = [
			'shelter:SH001',
			'SH001:shelter_manager',
			'shelter:SH002',
			'SH002:shelter_manager'
		];
		expect(codes(visibleShelters(roles, all))).toEqual(['SH001', 'SH002']);
	});

	it('shows nothing to a user with no shelter scope', () => {
		expect(visibleShelters(['registration_staff'], all)).toEqual([]);
	});
});

describe('visibleSheltersBasic', () => {
	it('keeps the wider view for a shelter manager', () => {
		expect(codes(visibleSheltersBasic(['shelter:SH001', 'SH001:shelter_manager'], all))).toEqual([
			'SH001',
			'SH002',
			'SH003'
		]);
	});

	it('scopes non-managers to every shelter they hold', () => {
		const roles = [
			'shelter:SH001',
			'SH001:registration_staff',
			'shelter:SH003',
			'SH003:registration_staff'
		];
		expect(codes(visibleSheltersBasic(roles, all))).toEqual(['SH001', 'SH003']);
	});
});
