import { describe, expect, it } from 'vitest';
import {
	CLAIM_DIALOG_DESCRIPTION,
	CLAIM_FLOW_STATUS_GUIDANCE,
	UNASSIGNED_QUEUE_BADGE_LABEL,
	UNASSIGNED_QUEUE_BADGE_SHORT,
	claimedPetSummaries,
	formatOpenMemberCardType,
	formatOpenMemberDemographicsLine,
	formatOpenMemberGender,
	formatOpenMemberIdentityLine,
	formatOpenMemberVulnerableGroup,
	formatOpenPetLabel,
	unassignedSearchCopyByLanguage,
	type OpenMemberHit,
	type OpenPetHit
} from './search';

const hasThai = (v: unknown) => /[฀-๿]/.test(JSON.stringify(v));

const member = {
	reserved_evacuee_id: 'evacuee:1',
	status: 'open' as const,
	first_name: 'Somchai',
	last_name: 'Jaidee',
	gender: 'male',
	phone: null as string | null,
	person_id: null as OpenMemberHit['person_id'],
	country: 'THAILAND',
	vulnerable_groups: [] as string[],
	special_needs: [] as string[]
};

describe('unassigned search copy by language', () => {
	it('Thai copy is the existing constants', () => {
		const th = unassignedSearchCopyByLanguage.th;
		expect(th.badgeLabel).toBe(UNASSIGNED_QUEUE_BADGE_LABEL);
		expect(th.badgeShort).toBe(UNASSIGNED_QUEUE_BADGE_SHORT);
		expect(th.claimFlowStatusGuidance).toBe(CLAIM_FLOW_STATUS_GUIDANCE);
		expect(th.claimDialogDescription).toBe(CLAIM_DIALOG_DESCRIPTION);
	});

	it('English copy has the same keys as Thai and no Thai text', () => {
		const { th, en } = unassignedSearchCopyByLanguage;
		expect(Object.keys(en).sort()).toEqual(Object.keys(th).sort());
		expect(Object.keys(en.cardType).sort()).toEqual(Object.keys(th.cardType).sort());
		expect(Object.keys(en.petSpecies).sort()).toEqual(Object.keys(th.petSpecies).sort());
		expect(Object.keys(en.gender).sort()).toEqual(Object.keys(th.gender).sort());
		expect(hasThai(en)).toBe(false);
		expect(en.badgeShort).toBe('Central queue');
	});
});

describe('claim preview formatters take an optional language', () => {
	it('gender and card type', () => {
		expect(formatOpenMemberGender('male')).toBe('ชาย');
		expect(formatOpenMemberGender('male', 'en')).toBe('Male');
		expect(formatOpenMemberGender('female', 'en')).toBe('Female');
		expect(formatOpenMemberGender(null, 'en')).toBe('Not specified');
		expect(formatOpenMemberCardType('national_id', 'en')).toBe('National ID card');
		expect(formatOpenMemberCardType('anonymous', 'en')).toBe('Anonymous');
	});

	it('vulnerable group follows master label_en', () => {
		expect(formatOpenMemberVulnerableGroup('pregnant', 'en')).toBe('Pregnant');
		expect(formatOpenMemberVulnerableGroup('unknown_code', 'en')).toBe('unknown_code');
	});

	it('identity and demographics lines', () => {
		expect(formatOpenMemberIdentityLine(member, 'en')).toBe('No phone · No ID number');
		expect(
			formatOpenMemberIdentityLine(
				{
					...member,
					phone: '0812345678',
					person_id: { cardType: 'passport', number: 'AA123' }
				},
				'en'
			)
		).toBe('0812345678 · Passport · AA123');
		expect(formatOpenMemberDemographicsLine(member, 'en')).toBe('Male · THAILAND');
	});

	it('pet label and claimed pet summaries', () => {
		const pet: OpenPetHit = {
			pet_id: 'pet:a',
			status: 'open',
			species: 'cat',
			count: 2,
			notes: 'Mimi'
		};
		expect(formatOpenPetLabel(pet)).toBe('แมว ×2 (Mimi)');
		expect(formatOpenPetLabel(pet, 'en')).toBe('Cat ×2 (Mimi)');
		expect(
			claimedPetSummaries([{ species: 'dog', count: 1, has_cage: true }], 'en')[0].details
		).toBe('Has cage');
		expect(claimedPetSummaries([{ species: 'dog', count: 1, has_cage: true }])[0].details).toBe(
			'มีกรง'
		);
	});
});
