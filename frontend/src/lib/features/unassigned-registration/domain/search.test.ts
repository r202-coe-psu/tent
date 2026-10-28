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
	petsLeftBehind,
	totalPetCount,
	type OpenMemberHit,
	type OpenPetHit
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

describe('claim flow status guidance (CR-140 addendum — claim on Report-in confirm)', () => {
	it('states selection alone writes nothing until confirmed on the review page', () => {
		expect(CLAIM_FLOW_STATUS_GUIDANCE).toContain('ยังไม่มีการรับเข้าศูนย์');
		expect(CLAIM_FLOW_STATUS_GUIDANCE).toContain('ตรวจสอบรายละเอียด');
		expect(CLAIM_FLOW_STATUS_GUIDANCE).toContain('pre_registered');
		expect(CLAIM_FLOW_STATUS_GUIDANCE).toContain('arriving');
	});

	it('exposes a short claim-dialog a11y description that does not promise admission yet', () => {
		expect(CLAIM_DIALOG_DESCRIPTION).toContain('สมาชิก');
		expect(CLAIM_DIALOG_DESCRIPTION).toContain('สัตว์เลี้ยง');
		expect(CLAIM_DIALOG_DESCRIPTION).toContain('ยังไม่รับเข้าศูนย์');
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
		expect(formatOpenMemberGender('other')).toBe('ไม่ระบุ');
		expect(formatOpenMemberGender(null)).toBe('ไม่ระบุ');
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

	it('carries the consent the member gave on the public form (FR-41)', () => {
		const consent = {
			mode: 'basic',
			health: false,
			ref: 'CS-7K3QZ9MD',
			given_at: '2026-10-25T03:15:00.000Z',
			notice_version: '2026-10-25',
			given_by: 'self',
			giver_evacuee_id: null,
			recorded_verbally_by: null,
			channel: 'web'
		};
		const hit = { ...baseMember, consent, search_excluded: true };
		expect(openMemberHitSchema.parse(hit)).toEqual(hit);
	});

	it('rejects a consent that breaks the contract', () => {
		const hit = {
			...baseMember,
			consent: { mode: 'basic', health: true, given_by: 'self' },
			search_excluded: true
		};
		expect(openMemberHitSchema.safeParse(hit).success).toBe(false);
	});
});

describe('isOnlineRequiredError', () => {
	it('detects ONLINE_REQUIRED envelope shapes', () => {
		expect(isOnlineRequiredError({ code: 'ONLINE_REQUIRED' })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'ONLINE_REQUIRED' } })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'OTHER' } })).toBe(false);
	});
});

describe('petsLeftBehind (#798)', () => {
	const pet = (id: string, count = 1): OpenPetHit => ({
		pet_id: id,
		status: 'open',
		species: 'dog',
		count
	});

	it('returns the open pets the claimer did not tick', () => {
		const open = [pet('pet:a'), pet('pet:b'), pet('pet:c')];

		expect(petsLeftBehind(open, ['pet:b']).map((p) => p.pet_id)).toEqual(['pet:a', 'pet:c']);
	});

	it('returns every open pet when nothing is ticked', () => {
		const open = [pet('pet:a'), pet('pet:b')];

		expect(petsLeftBehind(open, [])).toHaveLength(2);
	});

	it('returns nothing when every open pet is ticked', () => {
		const open = [pet('pet:a'), pet('pet:b')];

		expect(petsLeftBehind(open, ['pet:a', 'pet:b'])).toEqual([]);
	});

	it('ignores ticked ids that are no longer open', () => {
		const open = [pet('pet:a')];

		expect(petsLeftBehind(open, ['pet:a', 'pet:gone'])).toEqual([]);
	});

	it('handles an empty open list', () => {
		expect(petsLeftBehind([], ['pet:a'])).toEqual([]);
	});
});

describe('totalPetCount', () => {
	const pet = (id: string, count: number): OpenPetHit => ({
		pet_id: id,
		status: 'open',
		species: 'cat',
		count
	});

	it('sums the count of each row rather than counting rows', () => {
		expect(totalPetCount([pet('pet:a', 2), pet('pet:b', 3)])).toBe(5);
	});

	it('is zero for an empty list', () => {
		expect(totalPetCount([])).toBe(0);
	});
});
