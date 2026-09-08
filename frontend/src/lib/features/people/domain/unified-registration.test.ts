import { describe, expect, it } from 'vitest';
import { formatPersonName, isAnonymousId } from './people';
import {
	PRIMARY_CONTACT_LABEL,
	applyAnonymousIdToMember,
	blankUnifiedMember,
	memberCardLabel,
	parseUnifiedRegistration,
	planFamilyRegistration,
	togglePetSpecies,
	unifiedRegistrationInputSchema,
	type UnifiedRegistrationInput
} from './unified-registration';

function validMember(over: Partial<UnifiedRegistrationInput['members'][number]> = {}) {
	return {
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male' as const,
		phone: '0812345678',
		country: 'THAILAND',
		vulnerable_groups: [] as string[],
		special_needs: [] as string[],
		person_id: { cardType: 'national_id' as const, number: '1234567890123' },
		emergency_contact: { name: 'สมหญิง', phone: '0899999999', relation: 'คู่สมรส' },
		...over
	};
}

function validHousehold(
	over: Partial<UnifiedRegistrationInput['household']> = {}
): UnifiedRegistrationInput['household'] {
	return {
		housing_type: 'owned_house',
		residence_landmark: null,
		address_no: '12/3',
		village_no: null,
		subdistrict: 'หาดใหญ่',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90110',
		pets: [],
		vehicles: [],
		assets: null,
		...over
	};
}

function validInput(over: Partial<UnifiedRegistrationInput> = {}): UnifiedRegistrationInput {
	return {
		members: [validMember()],
		household: validHousehold(),
		...over
	};
}

describe('unified registration — member labels', () => {
	it('labels member index 0 as ผู้ติดต่อหลัก (Primary Contact)', () => {
		expect(PRIMARY_CONTACT_LABEL).toBe('ผู้ติดต่อหลัก');
		expect(memberCardLabel(0)).toBe('ผู้ติดต่อหลัก');
	});

	it('labels subsequent members as สมาชิก N without hierarchical wording', () => {
		expect(memberCardLabel(1)).toBe('สมาชิก 2');
		expect(memberCardLabel(2)).toBe('สมาชิก 3');
	});
});

describe('unified registration — homeless Residence', () => {
	it('accepts homeless with landmark and empty address_no', () => {
		const parsed = parseUnifiedRegistration(
			validInput({
				household: validHousehold({
					housing_type: 'homeless',
					address_no: null,
					residence_landmark: 'ใต้สะพานใกล้ตลาด'
				})
			})
		);
		expect(parsed.household.housing_type).toBe('homeless');
		expect(parsed.household.residence_landmark).toBe('ใต้สะพานใกล้ตลาด');
	});

	it('accepts homeless with complete geo and empty address_no', () => {
		const parsed = parseUnifiedRegistration(
			validInput({
				household: validHousehold({
					housing_type: 'homeless',
					address_no: null,
					residence_landmark: null,
					subdistrict: 'หาดใหญ่',
					district: 'หาดใหญ่',
					province: 'สงขลา'
				})
			})
		);
		expect(parsed.household.housing_type).toBe('homeless');
	});

	it('rejects homeless without landmark and without complete geo', () => {
		const result = unifiedRegistrationInputSchema.safeParse(
			validInput({
				household: validHousehold({
					housing_type: 'homeless',
					address_no: null,
					residence_landmark: null,
					subdistrict: '',
					district: '',
					province: ''
				})
			})
		);
		expect(result.success).toBe(false);
	});
});

describe('unified registration — pets quick-select', () => {
	it('toggles dog/cat species onto the pets list', () => {
		expect(togglePetSpecies([], 'dog')).toEqual([{ species: 'dog', count: 1 }]);
		expect(togglePetSpecies([{ species: 'dog', count: 1 }], 'dog')).toEqual([]);
		expect(togglePetSpecies([{ species: 'dog', count: 1 }], 'cat')).toEqual([
			{ species: 'dog', count: 1 },
			{ species: 'cat', count: 1 }
		]);
	});

	it('stores custom animals as other with mandatory notes', () => {
		const withOther = togglePetSpecies([], 'other', 'ลิง');
		expect(withOther).toEqual([{ species: 'other', count: 1, notes: 'ลิง' }]);

		const parsed = parseUnifiedRegistration(
			validInput({
				household: validHousehold({ pets: withOther })
			})
		);
		expect(parsed.household.pets[0]).toMatchObject({ species: 'other', notes: 'ลิง' });
	});

	it('rejects other pets without notes', () => {
		const result = unifiedRegistrationInputSchema.safeParse(
			validInput({
				household: validHousehold({
					pets: [{ species: 'other', count: 1 }]
				})
			})
		);
		expect(result.success).toBe(false);
	});
});

describe('unified registration — mononym and anonymous ID', () => {
	it('accepts empty last_name and renders cleanly via formatPersonName', () => {
		const parsed = parseUnifiedRegistration(
			validInput({
				members: [validMember({ first_name: 'Madonna', last_name: '' })]
			})
		);
		expect(parsed.members[0]?.last_name).toBe('');
		expect(formatPersonName(parsed.members[0]!)).toBe('Madonna');
	});

	it('applyAnonymousIdToMember sets cardType anonymous and ANON-{ulid}', () => {
		const member = applyAnonymousIdToMember(blankUnifiedMember());
		expect(member.person_id?.cardType).toBe('anonymous');
		expect(isAnonymousId(member.person_id?.number ?? '')).toBe(true);
	});
});

describe('unified registration — family plan', () => {
	it('plans 1 household + N members with head = member 0 for onsite arriving', () => {
		const plan = planFamilyRegistration(
			validInput({
				members: [
					validMember({ first_name: 'หัว' }),
					validMember({ first_name: 'ลูก', last_name: 'ใจดี', phone: null })
				]
			}),
			'onsite'
		);

		expect(plan.memberInputs).toHaveLength(2);
		expect(plan.memberInputs.every((m) => m.status === 'arriving')).toBe(true);
		expect(plan.householdInput.status).toBe('arriving');
		expect(plan.headMemberIndex).toBe(0);
		expect(plan.memberInputs[0]?.first_name).toBe('หัว');
		expect(plan.householdInput.label).toContain('หัว');
	});

	it('plans public channel members as pre_registered', () => {
		const plan = planFamilyRegistration(validInput(), 'public');
		expect(plan.memberInputs[0]?.status).toBe('pre_registered');
		expect(plan.householdInput.status).toBe('pre_registered');
	});

	it('requires at least one member', () => {
		const result = unifiedRegistrationInputSchema.safeParse(validInput({ members: [] }));
		expect(result.success).toBe(false);
	});
});
