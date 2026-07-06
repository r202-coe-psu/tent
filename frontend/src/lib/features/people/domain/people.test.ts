import { describe, it, expect } from 'vitest';
import {
	createEvacuee,
	createMovement,
	createScreening,
	applyMovementToStay,
	isEvacuee,
	createHousehold,
	isHousehold
} from './people';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

describe('createEvacuee', () => {
	it('stamps the envelope and applies spec defaults', () => {
		const e = createEvacuee(
			{ first_name: '  สมชาย ', last_name: 'ใจดี', gender: 'male', phone: '0812345678' },
			ctx
		);
		expect(e._id.startsWith('evacuee:')).toBe(true);
		expect(e.type).toBe('evacuee');
		expect(e.schema_v).toBe(2);
		expect(e.shelter_code).toBe('SH001');
		expect(e.created_by).toBe('staff1');
		expect(e.created_at).toBe(e.updated_at);
		expect(e.first_name).toBe('สมชาย'); // trimmed
		expect(e.privacy).toEqual({ search_excluded: false });
		expect(e.current_stay.status).toBe('registered');
		expect(e.country).toBe('THAILAND');
		expect(e.special_needs).toEqual([]);
		expect(e.registered_via).toBe('app');
		expect(isEvacuee(e)).toBe(true);
	});

	it('accepts "no phone" as null', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'other', phone: null }, ctx);
		expect(e.phone).toBeNull();
	});

	it('rejects an empty first name', () => {
		expect(() =>
			createEvacuee({ first_name: '  ', last_name: 'ข', gender: 'male', phone: null }, ctx)
		).toThrow();
	});
});

describe('movement → current_stay', () => {
	it('check_in moves the snapshot to checked_in at the event time', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		const m = createMovement(
			{
				evacuee_id: e._id,
				action: 'check_in',
				zone: 'Z1',
				occurred_at: '2026-06-11T03:00:00.000Z'
			},
			ctx
		);
		const updated = applyMovementToStay(e, m);
		expect(updated.current_stay.status).toBe('checked_in');
		expect(updated.current_stay.zone).toBe('Z1');
		expect(updated.current_stay.since).toBe('2026-06-11T03:00:00.000Z');
	});
});

describe('createScreening', () => {
	it('defaults the screening time to now when omitted', () => {
		const s = createScreening({ evacuee_id: 'evacuee:x', track: 'fast_track' }, ctx);
		expect(s.type).toBe('screening');
		expect(s.needs_referral).toBe(false);
		expect(s.symptoms).toEqual([]);
		expect(typeof s.screened_at).toBe('string');
	});
});

describe('createHousehold', () => {
	it('stamps the household document correctly and parses pets, assets, and vehicles', () => {
		const h = createHousehold(
			{
				label: ' บ้านทองดี ',
				head_evacuee_id: 'evacuee:123',
				municipality_zone: 'zone_1',
				community: 'z1_c01',
				pets: [
					{
						species: 'dog',
						count: 2,
						notes: 'friendly',
						has_cage: true,
						image_url: 'http://image.png'
					}
				],
				assets: { description: 'สร้อยคอทองคำ', image_url: null },
				vehicles: [{ type: 'car', license_plate: 'กข 1234' }],
				notes: 'ใกล้ประตูทางออก',
				address_no: ' 123/45 ',
				village_no: ' หมู่ 2 ',
				subdistrict: ' หาดใหญ่ ',
				district: ' หาดใหญ่ ',
				province: ' สงขลา ',
				postal_code: ' 90110 '
			},
			ctx
		);

		expect(h._id.startsWith('household:')).toBe(true);
		expect(h.type).toBe('household');
		expect(h.schema_v).toBe(3);
		expect(h.shelter_code).toBe('SH001');
		expect(h.created_by).toBe('staff1');
		expect(h.label).toBe('บ้านทองดี'); // trimmed
		expect(h.head_evacuee_id).toBe('evacuee:123');
		expect(h.municipality_zone).toBe('zone_1');
		expect(h.community).toBe('z1_c01');
		expect((h as unknown as { zone?: unknown }).zone).toBeUndefined();
		expect(h.pets).toEqual([
			{ species: 'dog', count: 2, notes: 'friendly', has_cage: true, image_url: 'http://image.png' }
		]);
		expect(h.assets).toEqual({ description: 'สร้อยคอทองคำ', image_url: null });
		expect(h.vehicles).toEqual([{ type: 'car', license_plate: 'กข 1234' }]);
		expect(h.notes).toBe('ใกล้ประตูทางออก');
		expect(h.address_no).toBe('123/45'); // trimmed
		expect(h.village_no).toBe('หมู่ 2'); // trimmed
		expect(h.subdistrict).toBe('หาดใหญ่'); // trimmed
		expect(h.district).toBe('หาดใหญ่'); // trimmed
		expect(h.province).toBe('สงขลา'); // trimmed
		expect(h.postal_code).toBe('90110'); // trimmed
		expect(isHousehold(h)).toBe(true);
	});

	it('sets omitted address fields to null to match schema', () => {
		const h = createHousehold(
			{
				label: 'บ้านเดียวดาย',
				head_evacuee_id: null,
				municipality_zone: null,
				community: null,
				pets: []
			},
			ctx
		);
		expect(h.address_no).toBeNull();
		expect(h.village_no).toBeNull();
		expect(h.subdistrict).toBeNull();
		expect(h.district).toBeNull();
		expect(h.province).toBeNull();
		expect(h.postal_code).toBeNull();
	});
});
