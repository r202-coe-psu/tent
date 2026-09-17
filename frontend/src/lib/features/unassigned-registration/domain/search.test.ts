import { describe, expect, it } from 'vitest';
import {
	CLAIM_DIALOG_DESCRIPTION,
	CLAIM_FLOW_STATUS_GUIDANCE,
	UNASSIGNED_QUEUE_BADGE_LABEL,
	UNASSIGNED_QUEUE_BADGE_SHORT,
	formatClaimCreatedAt,
	formatOpenMemberCardType,
	formatOpenMemberDemographicsLine,
	formatOpenMemberGender,
	formatOpenMemberIdentityLine,
	formatOpenMemberName,
	formatOpenMemberVulnerableGroup,
	isOnlineRequiredError,
	openMemberHitSchema,
	type OpenMemberHit
} from './search';

const baseMember = {
	reserved_evacuee_id: 'evacuee:1',
	status: 'open' as const,
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	gender: 'male',
	phone: null as string | null,
	person_id: null as OpenMemberHit['person_id'],
	country: 'THAILAND',
	vulnerable_groups: [] as string[],
	special_needs: [] as string[]
};

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

	it('exposes a short claim-dialog a11y description', () => {
		expect(CLAIM_DIALOG_DESCRIPTION).toBe('เลือกสมาชิกที่จะรับเข้าศูนย์นี้ แล้วกดยืนยัน');
	});
});

describe('formatOpenMemberName', () => {
	it('joins first and last name', () => {
		expect(formatOpenMemberName(baseMember)).toBe('สมชาย ใจดี');
	});
});

describe('open member claim preview formatters', () => {
	it('maps gender and card type to Thai labels', () => {
		expect(formatOpenMemberGender('male')).toBe('ชาย');
		expect(formatOpenMemberGender('female')).toBe('หญิง');
		expect(formatOpenMemberGender('other')).toBe('other');
		expect(formatOpenMemberCardType('national_id')).toBe('บัตรประชาชน');
		expect(formatOpenMemberCardType('passport')).toBe('พาสปอร์ต');
	});

	it('resolves vulnerable-group codes via CR-112 labels', () => {
		expect(formatOpenMemberVulnerableGroup('pregnant')).toBe('สตรีมีครรภ์');
		expect(formatOpenMemberVulnerableGroup('unknown_code')).toBe('unknown_code');
	});

	it('builds identity and demographics lines for claim preview', () => {
		expect(formatOpenMemberIdentityLine(baseMember)).toBe('ไม่มีเบอร์ · ไม่มีเลขบัตร');
		expect(
			formatOpenMemberIdentityLine({
				...baseMember,
				phone: '0812345678',
				person_id: { cardType: 'national_id', number: '1234567890123' }
			})
		).toBe('0812345678 · บัตรประชาชน · 1234567890123');
		expect(formatOpenMemberDemographicsLine(baseMember)).toBe('ชาย · THAILAND');
	});

	it('formats created_at in th-TH locale', () => {
		const formatted = formatClaimCreatedAt('2026-03-15T10:30:00.000Z');
		expect(formatted.length).toBeGreaterThan(0);
		expect(formatted).not.toBe('2026-03-15T10:30:00.000Z');
	});
});

describe('openMemberHitSchema', () => {
	it('parses an open member hit', () => {
		const hit = { ...baseMember };
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
