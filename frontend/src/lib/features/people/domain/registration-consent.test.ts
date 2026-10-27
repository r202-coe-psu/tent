import { describe, expect, it } from 'vitest';
import { mintConsentStamp, type EvacueeConsent } from '$lib/features/consent/server';
import { createEvacuee, registrationMedicalInput } from './people';
import {
	blankUnifiedMember,
	evacueeToUnifiedMember,
	memberFormKey,
	parseUnifiedRegistration,
	planMemberConsents
} from './unified-registration';

const ctx = { shelterCode: 'SH001', createdBy: 'staff01' };
const base = { first_name: 'สมชาย', last_name: 'ใจดี', gender: null, phone: null };
const consent: EvacueeConsent = {
	mode: 'basic',
	health: false,
	...mintConsentStamp(new Date('2026-10-25T03:00:00.000Z')),
	channel: 'staff',
	given_by: 'self',
	giver_evacuee_id: null,
	recorded_verbally_by: null
};

describe('createEvacuee consent write', () => {
	it('stores consent and its search exclusion at schema_v 15', () => {
		const e = createEvacuee(base, ctx, { consent, searchExcluded: true });
		expect(e.consent).toEqual(consent);
		expect(e.privacy.search_excluded).toBe(true);
		expect(e.schema_v).toBe(15);
	});

	it('keeps channels without the block visible in search and without consent (FR-44)', () => {
		const e = createEvacuee(base, ctx, null);
		expect(e).not.toHaveProperty('consent');
		expect(e.privacy.search_excluded).toBe(false);
		expect(e.schema_v).toBe(15);
	});
});

describe('registrationMedicalInput (FR-32)', () => {
	const filled = { medical_conditions: ['เบาหวาน'], medical_note: 'แพ้ยา' };

	it('builds the medical input when health consent allows it', () => {
		expect(
			registrationMedicalInput(filled, 'evacuee:1', { medicalAllowed: true }, 'normal')
		).toEqual({
			evacuee_id: 'evacuee:1',
			conditions: ['เบาหวาน'],
			allergies: [],
			medications: [],
			notes: 'แพ้ยา',
			track: 'normal'
		});
	});

	it('returns null when consent forbids health data', () => {
		expect(
			registrationMedicalInput(filled, 'evacuee:1', { medicalAllowed: false }, 'normal')
		).toBeNull();
	});

	it('keeps the old behaviour without a block and skips empty input', () => {
		expect(registrationMedicalInput(filled, 'evacuee:1', null, 'fast_track')?.track).toBe(
			'fast_track'
		);
		expect(registrationMedicalInput({}, 'evacuee:1', null, 'normal')).toBeNull();
	});
});

describe('member form keys', () => {
	it('gives every blank member a distinct key that the Zod parse strips', () => {
		const a = blankUnifiedMember();
		const b = blankUnifiedMember();
		expect(a.form_key).not.toBe(b.form_key);
		const parsed = parseUnifiedRegistration({
			members: [{ ...a, first_name: 'ก', person_id: { cardType: 'anonymous', number: '' } }],
			household: {
				housing_type: 'homeless',
				residence_landmark: 'ใต้สะพาน',
				pets: [],
				vehicles: [],
				assets: null
			}
		});
		expect(parsed.members[0]).not.toHaveProperty('form_key');
	});

	it('keys loaded evacuees by their id', () => {
		const evacuee = createEvacuee(base, ctx, null);
		expect(memberFormKey(evacueeToUnifiedMember(evacuee))).toBe(evacuee._id);
	});
});

describe('planMemberConsents', () => {
	const decision = {
		mode: 'full' as const,
		health: true,
		search_visible: true,
		guardian_for: [],
		verbal: false,
		...mintConsentStamp()
	};

	it('returns no plan for anyone without a block', () => {
		expect(planMemberConsents(null, 'staff', [false, false])).toEqual([undefined, undefined]);
	});

	it('plans in member order and skips members who already consented (FR-41)', () => {
		const plans = planMemberConsents(
			{ decision, memberKeys: ['a', 'b', 'c'], recordedBy: null },
			'staff',
			[false, false, true]
		);
		expect(plans.map((p) => p?.consent.given_by)).toEqual(['self', 'household_member', undefined]);
	});
});
