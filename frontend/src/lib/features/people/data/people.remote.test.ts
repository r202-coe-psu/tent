// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import { isAuditEntry } from '$lib/features/shared';

let mockShelterDb = 'shelter_sh001';
let memoryRepo = createInMemoryRepository();

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => mockShelterDb
}));

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return {
		...actual,
		createRemoteRepository: () => memoryRepo
	};
});

import { PeopleRemoteRepository, peopleRepository } from './people.remote';
import type { EvacueeInput } from '../domain/people';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function evInput(over: Partial<EvacueeInput> = {}): EvacueeInput {
	return {
		first_name: 'Somchai',
		last_name: 'Jaidee',
		gender: 'male',
		phone: '0812345678',
		...over
	};
}

describe('PeopleRemoteRepository', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	describe('createEvacuee', () => {
		it('persists the evacuee and returns it with an _id, _rev and correct type', async () => {
			const saved = await repo.createEvacuee(evInput(), ctx);

			expect(saved.type).toBe('evacuee');
			expect(saved._id).toMatch(/^evacuee:/);
			expect(saved._rev).toBeDefined();
			expect(saved.shelter_code).toBe('SH001');
			expect(saved.created_by).toBe('tester');

			const fetched = await repo.getEvacuee(saved._id);
			expect(fetched?.first_name).toBe('Somchai');
			expect(fetched?.current_stay.status).toBe('pre_registered');
			expect(fetched?.privacy.search_excluded).toBe(false);
		});

		it('writes a linked medical doc when medical fields are present', async () => {
			const saved = await repo.createEvacuee(
				evInput({ medical_conditions: ['diabetes'], medical_allergies: ['penicillin'] }),
				ctx
			);

			const medicals = await repo.listMedicals();
			expect(medicals).toHaveLength(1);
			expect(medicals[0].evacuee_id).toBe(saved._id);
		});

		it('does NOT write a medical doc when no medical fields are supplied', async () => {
			await repo.createEvacuee(evInput(), ctx);
			expect(await repo.listMedicals()).toHaveLength(0);
		});
	});

	describe('household membership invariant', () => {
		it('rejects moving a member away from an active household with other members', async () => {
			const first = await repo.createEvacuee(evInput({ first_name: 'First' }), ctx);
			const second = await repo.createEvacuee(evInput({ first_name: 'Second' }), ctx);
			const oldHousehold = await repo.createHousehold(
				{ label: 'ครัวเรือนเดิม', head_evacuee_id: first._id, status: 'checked_in' },
				ctx
			);
			const targetHousehold = await repo.createHousehold(
				{ label: 'ครัวเรือนใหม่', head_evacuee_id: null, status: 'checked_in' },
				ctx
			);
			const linkedFirst = await repo.updateEvacuee({ ...first, household_id: oldHousehold._id });
			await repo.updateEvacuee({ ...second, household_id: oldHousehold._id });

			await expect(
				repo.updateEvacuee({ ...linkedFirst, household_id: targetHousehold._id })
			).rejects.toThrow(/ยังมีสมาชิกอื่นอยู่/);
			expect((await repo.getEvacuee(first._id))?.household_id).toBe(oldHousehold._id);
		});

		it('moves a solo member and cancels the old household using fresh persisted data', async () => {
			const member = await repo.createEvacuee(evInput(), ctx);
			const oldHousehold = await repo.createHousehold(
				{ label: 'ครัวเรือนเดิม', head_evacuee_id: member._id, status: 'checked_in' },
				ctx
			);
			const targetHousehold = await repo.createHousehold(
				{ label: 'ครัวเรือนใหม่', head_evacuee_id: member._id, status: 'checked_in' },
				ctx
			);
			const linked = await repo.updateEvacuee({ ...member, household_id: oldHousehold._id });

			const moved = await repo.updateEvacuee({ ...linked, household_id: targetHousehold._id });

			expect(moved.household_id).toBe(targetHousehold._id);
			expect((await repo.getHousehold(oldHousehold._id))?.status).toBe('cancelled');
		});
	});

	describe('household history and status transitions', () => {
		it('keeps checked-out households available for direct profile/edit lookups', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนเก่า', head_evacuee_id: null, status: 'checked_out' },
				ctx
			);

			expect((await repo.listHouseholds()).map((item) => item._id)).toContain(household._id);
			expect((await repo.listHouseholdsPaginated(1, 10)).items.map((item) => item._id)).toContain(
				household._id
			);
		});

		it('rejects reopening a terminal household through the generic update path', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนเก่า', head_evacuee_id: null, status: 'checked_out' },
				ctx
			);

			await expect(repo.updateHousehold({ ...household, status: 'checked_in' })).rejects.toThrow(
				/ไม่สามารถเปลี่ยนสถานะ/
			);
		});
	});

	describe('searchEvacuees', () => {
		beforeEach(async () => {
			await repo.createEvacuee(
				evInput({
					first_name: 'Somchai',
					last_name: 'Jaidee',
					phone: '0812345678',
					person_id: { cardType: 'national_id', number: '1103700123456' }
				}),
				ctx
			);
			await repo.createEvacuee(
				evInput({ first_name: 'Malee', last_name: 'Suksan', phone: '0899999999' }),
				ctx
			);
		});

		it('returns [] for an empty query', async () => {
			expect(await repo.searchEvacuees('   ')).toEqual([]);
		});

		it('matches on full name (case-insensitive)', async () => {
			const hits = await repo.searchEvacuees('SOMCHAI jaidee');
			expect(hits).toHaveLength(1);
		});
	});
});

describe('check-in / check-out', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	describe('checkInEvacuee', () => {
		it('records a check_in movement and updates current_stay to active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);

			const updated = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			expect(updated.current_stay.status).toBe('active');
			expect(updated.current_stay.zone).toBe('zone-a');

			const movements = await repo.listMovements();
			expect(movements).toHaveLength(1);
			expect(movements[0]).toMatchObject({
				evacuee_id: evacuee._id,
				action: 'check_in',
				zone: 'zone-a'
			});
		});

		it('persists the updated status so a fresh fetch reflects it', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await repo.checkInEvacuee(evacuee, ctx);

			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('active');
		});

		it('touches updated_at when promoting a pre-registered household', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const createdHousehold = await repo.createHousehold(
				{
					label: 'บ้านทดสอบ',
					head_evacuee_id: evacuee._id,
					status: 'pre_registered'
				},
				ctx
			);
			const household = await memoryRepo.put({
				...createdHousehold,
				updated_at: '2000-01-01T00:00:00.000Z'
			});
			const linked = await repo.updateEvacuee({ ...evacuee, household_id: household._id });

			await repo.checkInEvacuee(linked, ctx);

			const promoted = await repo.getHousehold(household._id);
			expect(promoted?.status).toBe('checked_in');
			expect(promoted?.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
		});
	});

	describe('checkOutEvacuee', () => {
		it('records a check_out movement and updates current_stay to checked_out', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			const updated = await repo.checkOutEvacuee(checkedIn, ctx);

			expect(updated.current_stay.status).toBe('checked_out');

			const movements = await repo.listMovements();
			expect(movements).toHaveLength(2);
			expect(movements[1]).toMatchObject({
				evacuee_id: evacuee._id,
				action: 'check_out',
				zone: null
			});
		});

		it('persists the updated status so a fresh fetch reflects it', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx);
			await repo.checkOutEvacuee(checkedIn, ctx);

			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('checked_out');
		});

		it('rejects check-out when the evacuee is not active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await expect(repo.checkOutEvacuee(evacuee, ctx)).rejects.toThrow(/เช็คเอาท์/);
			expect(await repo.listMovements()).toHaveLength(0);
		});
	});

	it('rejects check-in when the evacuee is deceased', async () => {
		const evacuee = await repo.createEvacuee(evInput(), ctx);
		const deceased = {
			...evacuee,
			current_stay: {
				status: 'deceased' as const,
				zone: null,
				since: evacuee.current_stay.since
			}
		};
		await expect(repo.checkInEvacuee(deceased, ctx)).rejects.toThrow(/เสียชีวิต/);
		expect(await repo.listMovements()).toHaveLength(0);
		const fetched = await repo.getEvacuee(evacuee._id);
		expect(fetched?.current_stay.status).toBe('pre_registered');
	});

	describe('cancelPreRegistration', () => {
		it('cancels the household, preserves valid person stay status, and records the actor', async () => {
			const member = await repo.createEvacuee(evInput(), ctx);
			await repo.createEvacuee(evInput({ first_name: 'บุคคลนอกครัวเรือน' }), ctx);
			const hh = await repo.createHousehold(
				{
					label: 'บ้านทดสอบ',
					head_evacuee_id: member._id,
					status: 'pre_registered',
					municipality_zone: null,
					community: null,
					pets: [],
					vehicles: []
				},
				ctx
			);

			// Link member to household
			await repo.updateEvacuee({
				...member,
				household_id: hh._id
			});

			const findSpy = vi.spyOn(memoryRepo, 'find');
			await repo.cancelPreRegistration(hh._id, ctx);

			const fetchedHh = await repo.getHousehold(hh._id);
			expect(fetchedHh?.status).toBe('cancelled');

			const fetchedMember = await repo.getEvacuee(member._id);
			expect(fetchedMember?.current_stay.status).toBe('pre_registered');
			expect((await repo.listEvacuees()).map((evacuee) => evacuee._id)).toContain(member._id);
			expect(findSpy).toHaveBeenCalledWith({
				selector: { type: 'evacuee', household_id: hh._id },
				limit: 10_000
			});

			const audits = await memoryRepo.allByType('audit', isAuditEntry);
			expect(audits).toHaveLength(1);
			expect(audits[0]).toMatchObject({
				action: 'other',
				target_type: 'household',
				target_id: hh._id,
				created_by: 'tester',
				reason: 'ยกเลิกการลงทะเบียนครัวเรือนล่วงหน้า',
				context: {
					previous_status: 'pre_registered',
					next_status: 'cancelled',
					member_count: 1
				}
			});
		});

		it('throws an error if the household is not in pre_registered status', async () => {
			const member = await repo.createEvacuee(evInput(), ctx);
			const hh = await repo.createHousehold(
				{
					label: 'บ้านทดสอบ',
					head_evacuee_id: member._id,
					status: 'arriving',
					municipality_zone: null,
					community: null,
					pets: [],
					vehicles: []
				},
				ctx
			);

			await expect(repo.cancelPreRegistration(hh._id, ctx)).rejects.toThrow(/สามารถยกเลิกได้เฉพาะ/);
		});
	});
});

describe('peopleRepository singleton', () => {
	it('returns a fresh instance when getShelterDb() changes', () => {
		mockShelterDb = 'shelter_sh001';
		const repo1 = peopleRepository();
		mockShelterDb = 'shelter_sh002';
		const repo2 = peopleRepository();
		expect(repo2).not.toBe(repo1);
	});
});
