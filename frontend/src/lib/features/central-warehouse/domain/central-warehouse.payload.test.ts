import { describe, expect, it } from 'vitest';
import {
	M6PayloadError,
	buildM6WithdrawalPayload,
	cancelBodySchema,
	externalRefFor,
	withdrawalCreateInputSchema
} from './central-warehouse.payload';

const input = withdrawalCreateInputSchema.parse({
	source_warehouse_code: 'WH1',
	source_warehouse_name: 'คลังเมือง',
	reason: 'ของใกล้หมด',
	contact_role: 'หัวหน้าฝ่ายพัสดุ',
	contact_phone: '081-234-5678',
	lines: [
		{ item_code: 'W-1', name: 'น้ำดื่ม', unit: 'แพ็ค', type_code: 'water', qty: 10 },
		{ item_code: 'R-1', name: 'ข้าวสาร', unit: 'ถุง', qty: 3 }
	]
});

const shelter = {
	code: 'SH001',
	name: 'ศูนย์พักพิงทดสอบ',
	location: { address: '1 ถ.ทดสอบ', lat: 7.88, lng: 98.39 }
};
const actor = { name: 'สมชาย ใจดี', username: 'somchai' };
const base = { input, shelter, contactName: actor.name, actor, externalRef: 'TENT-SH001-01JX' };

describe('buildM6WithdrawalPayload', () => {
	it('builds requester and destination from the shelter master and the session', () => {
		const p = buildM6WithdrawalPayload(base);
		expect(p).toMatchObject({
			shelter_code: 'SH001',
			external_ref: 'TENT-SH001-01JX',
			source_warehouse_code: 'WH1',
			source_warehouse_name: 'คลังเมือง',
			reason: 'ของใกล้หมด',
			actor
		});
		expect(p.requester).toEqual({
			location_code: 'SH001',
			location_type: 'shelter',
			location_name: 'ศูนย์พักพิงทดสอบ',
			contact_name: 'สมชาย ใจดี',
			contact_role: 'หัวหน้าฝ่ายพัสดุ',
			contact_phone: '081-234-5678',
			external_ref: 'TENT-SH001-01JX'
		});
		expect(p.destination).toEqual({
			location_code: 'SH001',
			name: 'ศูนย์พักพิงทดสอบ',
			type: 'shelter',
			lat: 7.88,
			lng: 98.39,
			address: '1 ถ.ทดสอบ'
		});
		expect(p.lines).toEqual([
			{ item_code: 'W-1', name: 'น้ำดื่ม', unit: 'แพ็ค', type_code: 'water', qty: 10 },
			{ item_code: 'R-1', name: 'ข้าวสาร', unit: 'ถุง', qty: 3 }
		]);
	});

	it.each([
		['no location', undefined],
		['no lat/lng', { address: 'x' }],
		['no address', { lat: 7.8, lng: 98.3 }],
		['blank address', { address: '  ', lat: 7.8, lng: 98.3 }],
		['null coordinates', { address: 'x', lat: null, lng: null }],
		['0,0 coordinates', { address: 'x', lat: 0, lng: 0 }]
	])('blocks with SHELTER_LOCATION_MISSING: %s', (_label, location) => {
		const run = () => buildM6WithdrawalPayload({ ...base, shelter: { ...shelter, location } });
		expect(run).toThrow(M6PayloadError);
		try {
			run();
		} catch (e) {
			expect((e as M6PayloadError).code).toBe('SHELTER_LOCATION_MISSING');
			expect((e as M6PayloadError).message).toContain('ตั้งค่าตำแหน่งศูนย์');
		}
	});
});

describe('externalRefFor', () => {
	it('is TENT-{shelter}-{id}', () => {
		expect(externalRefFor('SH001', '01JXABC')).toBe('TENT-SH001-01JXABC');
	});

	it('refuses a key longer than 64 characters', () => {
		expect(() => externalRefFor('SH001', 'x'.repeat(80))).toThrow(M6PayloadError);
	});
});

describe('withdrawalCreateInputSchema', () => {
	const ok = {
		source_warehouse_code: 'WH1',
		reason: 'r',
		contact_role: 'ผู้จัดการ',
		contact_phone: '0812345678',
		lines: [{ item_code: 'A', name: 'a', unit: 'u', qty: 1 }]
	};

	it('accepts a valid body', () => {
		expect(withdrawalCreateInputSchema.safeParse(ok).success).toBe(true);
	});

	it.each([
		['fractional qty', { lines: [{ item_code: 'A', name: 'a', unit: 'u', qty: 1.5 }] }],
		['zero qty', { lines: [{ item_code: 'A', name: 'a', unit: 'u', qty: 0 }] }],
		['no lines', { lines: [] }],
		[
			'duplicate item',
			{
				lines: [
					{ item_code: 'A', name: 'a', unit: 'u', qty: 1 },
					{ item_code: 'A', name: 'a', unit: 'u', qty: 2 }
				]
			}
		],
		['blank reason', { reason: '  ' }],
		['blank role', { contact_role: '' }],
		['bad phone', { contact_phone: 'โทรมา' }],
		['no warehouse', { source_warehouse_code: '' }]
	])('rejects %s', (_label, patch) => {
		expect(withdrawalCreateInputSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
	});
});

describe('cancelBodySchema', () => {
	it('requires a reason', () => {
		expect(cancelBodySchema.safeParse({ reason: ' ' }).success).toBe(false);
		expect(cancelBodySchema.safeParse({ reason: 'สั่งผิด' }).success).toBe(true);
	});
});
