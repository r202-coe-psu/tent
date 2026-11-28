import { describe, expect, it } from 'vitest';
import { masterToSummary, visibleShelters, visibleSheltersBasic } from './shelters.remote';
import type { ShelterMaster } from '../domain/schema';

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

describe('masterToSummary', () => {
	const master = (over: Partial<ShelterMaster> = {}) =>
		({
			_id: 'shelter:x',
			type: 'shelter',
			schema_v: 12,
			code: 'SH001',
			name: 'ศูนย์อพยพโรงเรียนหาดใหญ่วิทยาลัย',
			site_kind: 'evacuation_center',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			...over
		}) as ShelterMaster;

	it('carries name_short, operating_org and delivery_note to the edit form', () => {
		const summary = masterToSummary(
			master({
				name_short: 'รร.หาดใหญ่วิทยาลัย',
				operating_org: 'เทศบาลนครหาดใหญ่',
				delivery_note: 'รถบรรทุกเกิน 6 ล้อเข้าไม่ได้'
			})
		);
		expect(summary).toMatchObject({
			name_short: 'รร.หาดใหญ่วิทยาลัย',
			operating_org: 'เทศบาลนครหาดใหญ่',
			delivery_note: 'รถบรรทุกเกิน 6 ล้อเข้าไม่ได้'
		});
	});

	it('reads a doc without the fields as null', () => {
		expect(masterToSummary(master())).toMatchObject({
			name_short: null,
			operating_org: null,
			delivery_note: null
		});
	});
});
