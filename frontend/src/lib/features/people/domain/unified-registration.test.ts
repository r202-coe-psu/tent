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
	householdToUnifiedInput,
	evacueeToUnifiedMember,
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

	it('clears address_no when housing_type is homeless even if a house number was submitted', () => {
		const parsed = parseUnifiedRegistration(
			validInput({
				household: validHousehold({
					housing_type: 'homeless',
					address_no: '12/3',
					residence_landmark: 'ใต้สะพาน'
				})
			})
		);
		expect(parsed.household.address_no).toBeNull();

		const plan = planFamilyRegistration(
			validInput({
				household: validHousehold({
					housing_type: 'homeless',
					address_no: '99/1',
					residence_landmark: 'ริมคลอง'
				})
			}),
			'onsite'
		);
		expect(plan.householdInput.address_no).toBeNull();
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

	it('rejects other pets whose notes are only the chip label อื่นๆ', () => {
		const result = unifiedRegistrationInputSchema.safeParse(
			validInput({
				household: validHousehold({
					pets: [{ species: 'other', count: 1, notes: 'อื่นๆ', image_url: 'img-1' }]
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

	it('blankUnifiedMember leaves gender unset for forced male/female choice', () => {
		const member = blankUnifiedMember();
		expect(member.gender).toBe('');
		expect(member.religion).toBe('unknown');
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

describe('unified registration — report-in converters', () => {
	it('converts CouchDB household into UnifiedHouseholdInput', () => {
		const household = {
			_id: 'hh-1',
			type: 'household' as const,
			label: 'บ้านใจดี',
			head_evacuee_id: 'ev-1',
			status: 'pre_registered' as const,
			housing_type: 'owned_house' as const,
			residence_landmark: 'ข้างวัด',
			address_no: '123/4',
			village_no: '5',
			subdistrict: 'ในเมือง',
			district: 'เมือง',
			province: 'เชียงใหม่',
			postal_code: '50000',
			pets: [{ species: 'dog' as const, count: 2 }],
			vehicles: [{ type: 'car' as const, license_plate: 'กก 1234' }],
			assets: { description: 'สร้อยคอ', image_url: null },
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			shelter_code: 'SH001'
		};

		const input = householdToUnifiedInput(household as unknown as import('./people').Household);
		expect(input.housing_type).toBe('owned_house');
		expect(input.address_no).toBe('123/4');
		expect(input.province).toBe('เชียงใหม่');
		expect(input.pets).toHaveLength(1);
		expect(input.vehicles).toHaveLength(1);
		expect(input.assets?.description).toBe('สร้อยคอ');
	});

	it('converts CouchDB evacuee into UnifiedMemberWithMeta and handles reporting_in flag', () => {
		const evacuee = {
			_id: 'ev-1',
			_rev: '1-abc',
			type: 'evacuee' as const,
			household_id: 'hh-1',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male' as const,
			phone: '0812345678',
			person_id: { cardType: 'national_id' as const, number: '1234567890123' },
			current_stay: {
				status: 'pre_registered' as const,
				zone: null,
				since: '2026-01-01T00:00:00.000Z'
			},
			registered_via: 'web' as const,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			shelter_code: 'SH001'
		};

		const member = evacueeToUnifiedMember(evacuee as unknown as import('./people').Evacuee, 'ev-1');
		expect(member._id).toBe('ev-1');
		expect(member.first_name).toBe('สมชาย');
		expect(member.stay_status).toBe('pre_registered');
		expect(member.reporting_in).toBe(true);

		// If target was a different ID, reporting_in is false
		const otherMember = evacueeToUnifiedMember(
			evacuee as unknown as import('./people').Evacuee,
			'ev-2'
		);
		expect(otherMember.reporting_in).toBe(false);
	});

	it('pre-fills address from evacuee card_snapshot when household is null (Kiosk flow)', () => {
		const kioskEvacuee = {
			_id: 'ev-kiosk-1',
			type: 'evacuee' as const,
			household_id: null,
			first_name: 'กิตติศักดิ์',
			last_name: 'มณีรัตน์',
			gender: 'male' as const,
			card_snapshot: {
				citizen_id: '1909800123456',
				address_no: '12/4',
				village_no: '3',
				lane: 'ซอย 5',
				road: 'ถ.เพชรเกษม',
				subdistrict: 'ตำบลหาดใหญ่',
				district: 'อำเภอหาดใหญ่',
				province: 'จังหวัดสงขลา',
				postal_code: '90110',
				photo_base64: 'data:image/jpeg;base64,mockphoto'
			},
			current_stay: {
				status: 'pre_registered' as const,
				zone: null,
				since: '2026-01-01T00:00:00.000Z'
			},
			registered_via: 'kiosk' as const,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			shelter_code: 'SH001'
		};

		const input = householdToUnifiedInput(
			null,
			kioskEvacuee as unknown as import('./people').Evacuee
		);
		expect(input.address_no).toBe('12/4');
		expect(input.village_no).toBe('3 ซอย 5 ถ.เพชรเกษม');
		expect(input.subdistrict).toBe('หาดใหญ่');
		expect(input.district).toBe('หาดใหญ่');
		expect(input.province).toBe('สงขลา');
		expect(input.postal_code).toBe('90110');

		const member = evacueeToUnifiedMember(
			kioskEvacuee as unknown as import('./people').Evacuee,
			'ev-kiosk-1'
		);
		expect(member.photo).toBe('data:image/jpeg;base64,mockphoto');
	});
});
