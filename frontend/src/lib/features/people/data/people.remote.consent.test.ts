// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import {
	mintConsentStamp,
	type ConsentDecision,
	type EvacueeConsent
} from '$lib/features/consent/server';

let memoryRepo = createInMemoryRepository();

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

import { PeopleRemoteRepository } from './people.remote';
import type { Evacuee, Medical } from '../domain/people';
import type {
	RegistrationConsent,
	UnifiedHouseholdInput,
	UnifiedMemberInput
} from '../domain/unified-registration';

const ctx = { shelterCode: 'SH001', createdBy: 'staff01' };
const NOW = new Date('2026-10-25T03:00:00.000Z');

const household: UnifiedHouseholdInput = {
	housing_type: 'owned_house',
	address_no: '1',
	subdistrict: 'ในเมือง',
	district: 'เมือง',
	province: 'เชียงใหม่',
	pets: [],
	vehicles: [],
	assets: null
};

function member(first_name: string, over: Partial<UnifiedMemberInput> = {}): UnifiedMemberInput {
	return {
		first_name,
		last_name: 'ใจดี',
		gender: null,
		phone: null,
		country: 'THAILAND',
		person_id: { cardType: 'anonymous', number: '' },
		...over
	};
}

const withMedical = { medical_conditions: ['เบาหวาน'] };

function full(over: Partial<Extract<ConsentDecision, { mode: 'full' }>> = {}): ConsentDecision {
	return {
		mode: 'full',
		health: true,
		search_visible: true,
		guardian_for: [],
		verbal: false,
		...mintConsentStamp(NOW),
		...over
	};
}

function consentFor(decision: ConsentDecision, keys: string[]): RegistrationConsent {
	return { decision, memberKeys: keys, recordedBy: 'staff01' };
}

async function medicalsOf(evacueeId: string): Promise<Medical[]> {
	const docs = await memoryRepo.allByType<Medical>(
		'medical',
		(d): d is Medical => (d as Medical).type === 'medical'
	);
	return docs.filter((d) => d.evacuee_id === evacueeId);
}

describe('createFamilyRegistration with consent', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	it('writes one consent to every member with giver roles, privacy and schema_v 15', async () => {
		const decision = full({ verbal: true });
		const { members } = await repo.createFamilyRegistration(
			{ members: [member('พ่อ'), member('ลูก'), member('ยาย')], household },
			ctx,
			'onsite',
			undefined,
			consentFor(decision, ['k-head', 'k-child', 'k-gran'])
		);

		const [head, child, gran] = members;
		expect(members.map((m) => m.consent?.ref)).toEqual([decision.ref, decision.ref, decision.ref]);
		expect(members.map((m) => m.schema_v)).toEqual([15, 15, 15]);
		expect(members.every((m) => m.privacy.search_excluded === false)).toBe(true);
		expect(head.consent).toMatchObject({
			mode: 'full',
			health: true,
			given_by: 'self',
			giver_evacuee_id: null,
			channel: 'staff',
			recorded_verbally_by: 'staff01'
		});
		expect(child.consent).toMatchObject({
			given_by: 'household_member',
			giver_evacuee_id: head._id
		});
		expect(gran.consent).toMatchObject({
			given_by: 'household_member',
			giver_evacuee_id: head._id
		});
	});

	it('creates the registration medical doc only with health consent (FR-32)', async () => {
		const { members } = await repo.createFamilyRegistration(
			{ members: [member('พ่อ', withMedical)], household },
			ctx,
			'onsite',
			undefined,
			consentFor(full({ health: true }), ['k-head'])
		);
		expect(await medicalsOf(members[0]._id)).toHaveLength(1);
	});

	it('drops medical input but keeps vulnerable groups when health is refused', async () => {
		const { members } = await repo.createFamilyRegistration(
			{
				members: [member('พ่อ', { ...withMedical, vulnerable_groups: ['elderly'] })],
				household
			},
			ctx,
			'onsite',
			undefined,
			consentFor(full({ health: false }), ['k-head'])
		);
		expect(await medicalsOf(members[0]._id)).toHaveLength(0);
		expect(members[0].vulnerable_groups).toHaveLength(1);
		expect(members[0].consent).toMatchObject({ mode: 'full', health: false });
	});

	it('hides everyone from search and writes no medical doc when C2 and C3 are unticked (FR-30/FR-32)', async () => {
		const { members } = await repo.createFamilyRegistration(
			{ members: [member('พ่อ', withMedical), member('ลูก')], household },
			ctx,
			'onsite',
			undefined,
			consentFor(full({ health: false, search_visible: false }), ['k-head', 'k-child'])
		);
		expect(members.every((m) => m.privacy.search_excluded)).toBe(true);
		expect(members.every((m) => m.consent?.mode === 'full' && !m.consent.health)).toBe(true);
		expect(await medicalsOf(members[0]._id)).toHaveLength(0);
	});

	it('excludes from search when C3 is unticked in full mode (FR-30)', async () => {
		const { members } = await repo.createFamilyRegistration(
			{ members: [member('พ่อ')], household },
			ctx,
			'onsite',
			undefined,
			consentFor(full({ search_visible: false }), ['k-head'])
		);
		expect(members[0].privacy.search_excluded).toBe(true);
		expect(members[0].consent?.mode).toBe('full');
	});

	it('keeps the pre-consent behaviour without a block', async () => {
		const { members } = await repo.createFamilyRegistration(
			{ members: [member('พ่อ', withMedical)], household },
			ctx,
			'onsite'
		);
		expect(members[0].consent).toBeUndefined();
		expect(members[0].privacy.search_excluded).toBe(false);
		expect(await medicalsOf(members[0]._id)).toHaveLength(1);
	});

	it('rejects consent keys that do not line up with the members', async () => {
		await expect(
			repo.createFamilyRegistration(
				{ members: [member('พ่อ'), member('ลูก')], household },
				ctx,
				'onsite',
				undefined,
				consentFor(full(), ['k-head'])
			)
		).rejects.toThrow(/consent member keys/);
	});
});

describe('submitFamilyReportIn with consent (FR-41)', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	async function preRegisteredFamily(): Promise<{ householdId: string; members: Evacuee[] }> {
		const { household: hh, members } = await repo.createFamilyRegistration(
			{ members: [member('พ่อ'), member('แม่')], household },
			ctx,
			'public'
		);
		return { householdId: hh._id, members };
	}

	it('records consent only for members who have none and leaves the others untouched', async () => {
		const family = await preRegisteredFamily();
		const [dad, mom] = family.members;
		const earlier: EvacueeConsent = {
			mode: 'full',
			health: false,
			...mintConsentStamp(new Date('2026-10-01T00:00:00Z')),
			channel: 'web',
			given_by: 'self',
			giver_evacuee_id: null,
			recorded_verbally_by: null
		};
		await repo.updateEvacuee({ ...mom, consent: earlier, privacy: { search_excluded: true } });

		const decision = full();
		await repo.submitFamilyReportIn({
			householdId: family.householdId,
			household,
			members: [
				{ ...member('พ่อ'), _id: dad._id, reporting_in: true },
				{ ...member('แม่'), _id: mom._id, reporting_in: true }
			],
			ctx,
			consent: consentFor(decision, [dad._id, mom._id])
		});

		const dadAfter = await repo.getEvacuee(dad._id);
		const momAfter = await repo.getEvacuee(mom._id);
		expect(dadAfter?.consent).toMatchObject({ ref: decision.ref, given_by: 'self' });
		expect(dadAfter?.schema_v).toBe(15);
		expect(dadAfter?.privacy.search_excluded).toBe(false);
		expect(momAfter?.consent?.ref).toBe(earlier.ref);
		expect(momAfter?.privacy.search_excluded).toBe(true);
	});

	it('gives a member added at report-in the new consent from the registrant', async () => {
		const family = await preRegisteredFamily();
		const [dad, mom] = family.members;
		const decision = full({ health: false, search_visible: false });
		await repo.submitFamilyReportIn({
			householdId: family.householdId,
			household,
			members: [
				{ ...member('พ่อ'), _id: dad._id, reporting_in: true },
				{ ...member('แม่'), _id: mom._id, reporting_in: false },
				{ ...member('ลูก', withMedical), reporting_in: true }
			],
			ctx,
			consent: consentFor(decision, [dad._id, mom._id, 'k-new'])
		});

		const all = await repo.listEvacuees();
		const child = all.find((e) => e.first_name === 'ลูก');
		expect(child?.consent).toMatchObject({
			mode: 'full',
			health: false,
			given_by: 'household_member',
			giver_evacuee_id: dad._id
		});
		expect(child?.privacy.search_excluded).toBe(true);
		expect(child?.schema_v).toBe(15);
		expect(await medicalsOf(child!._id)).toHaveLength(0);
	});

	it('leaves consent, privacy and schema_v alone without a block', async () => {
		const family = await preRegisteredFamily();
		const [dad] = family.members;
		await repo.submitFamilyReportIn({
			householdId: family.householdId,
			household,
			members: [{ ...member('พ่อ'), _id: dad._id, reporting_in: true }],
			ctx
		});
		const after = await repo.getEvacuee(dad._id);
		expect(after?.consent).toBeUndefined();
		expect(after?.privacy.search_excluded).toBe(false);
	});
});
