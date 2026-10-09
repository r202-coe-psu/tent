import { describe, expect, it } from 'vitest';
import { unassignedMemberToUnifiedMember } from './review';
import { openMemberHitSchema, type OpenMemberHit } from './search';

const baseMember: OpenMemberHit = {
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
};

describe('unassignedMemberToUnifiedMember gender (decision sync 2026-10-09)', () => {
	it('keeps male/female', () => {
		expect(unassignedMemberToUnifiedMember(baseMember).gender).toBe('male');
		expect(unassignedMemberToUnifiedMember({ ...baseMember, gender: 'female' }).gender).toBe(
			'female'
		);
	});

	it('keeps null as null (ไม่ระบุ) — never coerces to other', () => {
		const member = { ...baseMember, gender: null };
		expect(openMemberHitSchema.safeParse(member).success).toBe(true);
		expect(unassignedMemberToUnifiedMember(member).gender).toBeNull();
	});

	it('preserves legacy other', () => {
		expect(unassignedMemberToUnifiedMember({ ...baseMember, gender: 'other' }).gender).toBe(
			'other'
		);
	});

	it('maps unknown strings to null', () => {
		expect(unassignedMemberToUnifiedMember({ ...baseMember, gender: 'x' }).gender).toBeNull();
	});
});
