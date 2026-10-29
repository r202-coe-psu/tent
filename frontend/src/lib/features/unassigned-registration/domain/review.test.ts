import { describe, expect, it } from 'vitest';
import {
	countPetGroups,
	petsForReportIn,
	petsOverCapForConfirm,
	unassignedMemberToUnifiedMember
} from './review';
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

describe('petsForReportIn (#798)', () => {
	const claimed = { species: 'dog', count: 1, notes: 'ชื่อ หมาดำ' } as const;
	const typed = { species: 'cat', count: 2 } as const;

	it('keeps the rows claim wrote when staff typed nothing', () => {
		expect(petsForReportIn([claimed], [])).toEqual([claimed]);
	});

	it('keeps the rows staff typed when claim brought none', () => {
		expect(petsForReportIn([], [typed])).toEqual([typed]);
	});

	it('never drops one side for the other', () => {
		expect(petsForReportIn([claimed], [typed])).toEqual([claimed, typed]);
	});

	it('puts what claim wrote first so its rows keep their order', () => {
		const second = { species: 'other', count: 1, notes: 'กระต่าย' } as const;

		expect(petsForReportIn([claimed, second], [typed]).map((p) => p.species)).toEqual([
			'dog',
			'other',
			'cat'
		]);
	});

	it('treats a household with no pets field as no pets', () => {
		expect(petsForReportIn(undefined, [typed])).toEqual([typed]);
		expect(petsForReportIn(null, [typed])).toEqual([typed]);
	});

	it('is empty when neither side has pets', () => {
		expect(petsForReportIn([], [])).toEqual([]);
	});

	it('does not mutate either input', () => {
		const claimedRows = [claimed];
		const typedRows = [typed];

		petsForReportIn(claimedRows, typedRows);

		expect(claimedRows).toHaveLength(1);
		expect(typedRows).toHaveLength(1);
	});
});

describe('countPetGroups', () => {
	it('adds up the count of each row rather than counting rows', () => {
		expect(
			countPetGroups([
				{ species: 'dog', count: 3 },
				{ species: 'cat', count: 2 }
			])
		).toBe(5);
	});

	it('treats a row with no usable count as one animal', () => {
		expect(countPetGroups([{ species: 'dog' } as never])).toBe(1);
	});

	it('is zero for nothing at all', () => {
		expect(countPetGroups([])).toBe(0);
		expect(countPetGroups(null)).toBe(0);
		expect(countPetGroups(undefined)).toBe(0);
	});
});

describe('petsOverCapForConfirm (CR-148 cap stays enforced across both sources)', () => {
	it('adds the household, the claim and the form together', () => {
		const result = petsOverCapForConfirm([{ species: 'dog', count: 2 }], 3, [
			{ species: 'cat', count: 1 }
		]);

		expect(result.total).toBe(6);
		expect(result.over).toBe(0);
	});

	it('allows exactly the cap', () => {
		expect(petsOverCapForConfirm([], 10, []).over).toBe(0);
	});

	it('reports how many animals are over the cap', () => {
		const result = petsOverCapForConfirm([], 8, [{ species: 'cat', count: 5 }]);

		expect(result.total).toBe(13);
		expect(result.cap).toBe(10);
		expect(result.over).toBe(3);
	});

	it('catches an overflow that neither side would catch on its own', () => {
		expect(petsOverCapForConfirm([], 9, [{ species: 'cat', count: 1 }]).over).toBe(0);
		expect(petsOverCapForConfirm([], 9, [{ species: 'cat', count: 2 }]).over).toBe(1);
	});

	it('ignores a negative claim count', () => {
		expect(petsOverCapForConfirm([], -5, [{ species: 'cat', count: 1 }]).total).toBe(1);
	});

	it('is empty-safe', () => {
		expect(petsOverCapForConfirm(null, 0, null)).toEqual({ total: 0, over: 0, cap: 10 });
	});
});
