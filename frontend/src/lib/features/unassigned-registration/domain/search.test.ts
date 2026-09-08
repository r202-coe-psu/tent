import { describe, expect, it } from 'vitest';
import {
	CLAIM_FLOW_STATUS_GUIDANCE,
	UNASSIGNED_QUEUE_BADGE_LABEL,
	UNASSIGNED_QUEUE_BADGE_SHORT,
	formatOpenMemberName,
	isOnlineRequiredError,
	openMemberHitSchema
} from './search';

describe('unassigned queue badges (#250)', () => {
	it('exposes the distinct คิวกลาง labels for Station 1 results', () => {
		expect(UNASSIGNED_QUEUE_BADGE_SHORT).toBe('คิวกลาง');
		expect(UNASSIGNED_QUEUE_BADGE_LABEL).toBe('คิวกลาง / ยังไม่ระบุศูนย์');
	});
});

describe('claim flow status guidance (#250 follow-up)', () => {
	it('states claim creates pre_registered then Report-in advances to arriving', () => {
		expect(CLAIM_FLOW_STATUS_GUIDANCE).toBe(
			'รับเข้าศูนย์จะสร้าง Evacuee ใน Couch ที่สถานะ ลงทะเบียนล่วงหน้า (pre_registered) จากนั้นเปิดหน้า รายงานตัว (Report-in) เพื่อยืนยันข้อมูล แล้วเลื่อนเป็น มาถึงศูนย์ / รอคัดกรอง (arriving)'
		);
	});
});

describe('formatOpenMemberName', () => {
	it('joins first and last name', () => {
		expect(
			formatOpenMemberName({
				reserved_evacuee_id: 'evacuee:1',
				status: 'open',
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				gender: 'male',
				phone: null,
				person_id: null,
				country: 'THAILAND',
				vulnerable_groups: [],
				special_needs: []
			})
		).toBe('สมชาย ใจดี');
	});
});

describe('openMemberHitSchema', () => {
	it('parses an open member hit', () => {
		const hit = {
			reserved_evacuee_id: 'evacuee:1',
			status: 'open' as const,
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: null,
			person_id: null,
			country: 'THAILAND',
			vulnerable_groups: [],
			special_needs: []
		};
		expect(openMemberHitSchema.parse(hit)).toEqual(hit);
	});
});

describe('isOnlineRequiredError', () => {
	it('detects ONLINE_REQUIRED envelope shapes', () => {
		expect(isOnlineRequiredError({ code: 'ONLINE_REQUIRED' })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'ONLINE_REQUIRED' } })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'OTHER' } })).toBe(false);
	});
});
