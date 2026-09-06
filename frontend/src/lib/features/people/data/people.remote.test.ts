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

		it('persists vulnerable_groups and special_needs independently', async () => {
			const saved = await repo.createEvacuee(
				evInput({
					vulnerable_groups: ['elderly', 'wheelchair'],
					special_needs: ['ใช้ออกซิเจน']
				}),
				ctx
			);

			expect(saved.vulnerable_groups).toEqual(['elderly_dependent', 'wheelchair']);
			expect(saved.special_needs).toEqual(['ใช้ออกซิเจน']);

			const fetched = await repo.getEvacuee(saved._id);
			expect(fetched?.vulnerable_groups).toEqual(['elderly_dependent', 'wheelchair']);
			expect(fetched?.special_needs).toEqual(['ใช้ออกซิเจน']);
		});

		it('hard-migrates legacy VG codes on updateEvacuee', async () => {
			const saved = await repo.createEvacuee(evInput({ vulnerable_groups: ['wheelchair'] }), ctx);
			const updated = await repo.updateEvacuee({
				...saved,
				vulnerable_groups: ['elderly', 'disabled']
			});
			expect(updated.vulnerable_groups).toEqual(['elderly_dependent', 'disability_other']);
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

		it('rejects assigning a new evacuee to a cancelled/checked-out household', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนปิดแล้ว', head_evacuee_id: null, status: 'cancelled' },
				ctx
			);

			await expect(
				repo.createEvacuee(evInput({ household_id: household._id }), ctx)
			).rejects.toThrow(/ยกเลิกหรือเช็คเอาท์แล้ว/);
			expect(await repo.listEvacuees()).toHaveLength(0);
		});

		it('rejects assigning a new evacuee to a non-existent household', async () => {
			await expect(
				repo.createEvacuee(evInput({ household_id: 'household:missing' }), ctx)
			).rejects.toThrow(/ไม่พบครัวเรือนปลายทาง/);
		});

		it('allows assigning a new evacuee to an active household', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนเปิดอยู่', head_evacuee_id: null, status: 'checked_in' },
				ctx
			);

			const saved = await repo.createEvacuee(evInput({ household_id: household._id }), ctx);
			expect(saved.household_id).toBe(household._id);
		});

		it('updates pre_registered evacuee details when registered with draft_id', async () => {
			const preRegEvacuee = await repo.createEvacuee(
				evInput({ first_name: 'บัตร', last_name: 'สแกน', registered_via: 'kiosk' }),
				ctx
			);

			const registered = await repo.createEvacuee(
				{
					...evInput({ first_name: 'สมชาย', last_name: 'สแกน', registered_via: 'kiosk' }),
					draft_id: preRegEvacuee._id
				},
				ctx
			);

			expect(registered._id).toBe(preRegEvacuee._id);
			expect(registered.first_name).toBe('สมชาย');
			expect(registered.current_stay.status).toBe('pre_registered');

			const fetched = await repo.getEvacuee(preRegEvacuee._id);
			expect(fetched?.current_stay.status).toBe('pre_registered');
		});
	});

	describe('updateMedical', () => {
		it('updates an existing medical record with a fresh revision', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const medical = await repo.createMedical(
				{
					evacuee_id: evacuee._id,
					conditions: ['asthma'],
					medications: [],
					allergies: [],
					track: 'normal'
				},
				ctx
			);

			const updated = await repo.updateMedical({
				...medical,
				conditions: ['asthma', 'diabetes'],
				blood_group: 'O'
			});

			expect(updated.conditions).toEqual(['asthma', 'diabetes']);
			expect(updated.blood_group).toBe('O');
			expect(updated._rev).not.toBe(medical._rev);
		});
	});

	describe('section patches', () => {
		it('merges evacuee section fields into the latest persisted revision', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);

			await repo.patchEvacuee(evacuee._id, { first_name: 'ชื่อใหม่' });
			await repo.patchEvacuee(evacuee._id, {
				emergency_contact: { name: 'ญาติ', phone: '0812345678', relation: 'มารดา' }
			});

			const saved = await repo.getEvacuee(evacuee._id);
			expect(saved?.first_name).toBe('ชื่อใหม่');
			expect(saved?.emergency_contact?.name).toBe('ญาติ');
		});

		it('merges household section fields without replacing unrelated values', async () => {
			const household = await repo.createHousehold({ label: 'ครัวเรือนหนึ่ง' }, ctx);

			await repo.patchHousehold(household._id, { province: 'เชียงใหม่' });
			await repo.patchHousehold(household._id, { head_evacuee_id: 'evacuee:test' });

			const saved = await repo.getHousehold(household._id);
			expect(saved?.province).toBe('เชียงใหม่');
			expect(saved?.head_evacuee_id).toBe('evacuee:test');
		});
	});

	describe('household membership invariant', () => {
		it('rejects moving the head away from an active household with other members', async () => {
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

		it('allows a non-head to leave after head transfer (CR-106)', async () => {
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
			await repo.updateEvacuee({ ...first, household_id: oldHousehold._id });
			const linkedSecond = await repo.updateEvacuee({
				...second,
				household_id: oldHousehold._id
			});

			const moved = await repo.updateEvacuee({
				...linkedSecond,
				household_id: targetHousehold._id
			});
			expect(moved.household_id).toBe(targetHousehold._id);
			expect((await repo.getEvacuee(first._id))?.household_id).toBe(oldHousehold._id);
		});

		it('rejects removing the head from an active household with other members', async () => {
			const first = await repo.createEvacuee(evInput({ first_name: 'First' }), ctx);
			const second = await repo.createEvacuee(evInput({ first_name: 'Second' }), ctx);
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนเดิม', head_evacuee_id: first._id, status: 'checked_in' },
				ctx
			);
			await repo.patchEvacuee(first._id, { household_id: household._id });
			await repo.patchEvacuee(second._id, { household_id: household._id });

			await expect(repo.patchEvacuee(first._id, { household_id: null })).rejects.toThrow(
				/ยังมีสมาชิกอื่นอยู่/
			);
			expect((await repo.getEvacuee(first._id))?.household_id).toBe(household._id);
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
			const cancelledHousehold = await repo.getHousehold(oldHousehold._id);
			expect(cancelledHousehold?.status).toBe('cancelled');
			expect(cancelledHousehold?.head_evacuee_id).toBeNull();
		});
	});

	describe('household history and derived status (CR-112 A2)', () => {
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

		it('ignores free-form status overrides on updateHousehold', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนเก่า', head_evacuee_id: null, status: 'checked_out' },
				ctx
			);

			const updated = await repo.updateHousehold({ ...household, status: 'checked_in' });
			// No members → derived cancelled; client status is not authoritative.
			expect(updated.status).toBe('cancelled');
		});

		it('requires checkout_destination when derived status is checked_out', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนทดสอบ', head_evacuee_id: null, status: 'checked_in' },
				ctx
			);
			const member = await repo.createEvacuee(
				evInput({ first_name: 'Out', household_id: household._id, status: 'checked_out' }),
				ctx
			);
			await repo.updateEvacuee({ ...member, household_id: household._id });

			await expect(
				repo.updateHousehold({ ...household, checkout_destination: null })
			).rejects.toThrow(/ต้องระบุปลายทาง/);
		});

		it('rejects checked_out derive when destination type lacks required sub-field', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนทดสอบ', head_evacuee_id: null, status: 'checked_in' },
				ctx
			);
			const member = await repo.createEvacuee(
				evInput({ first_name: 'Out', household_id: household._id, status: 'checked_out' }),
				ctx
			);
			await repo.updateEvacuee({ ...member, household_id: household._id });

			await expect(
				repo.updateHousehold({
					...household,
					checkout_destination: { type: 'transferred_shelter' }
				})
			).rejects.toThrow(/ชื่อ\/รหัสสถานที่ปลายทาง/);
		});

		it('accepts derived checked_out with a valid checkout_destination', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนทดสอบ', head_evacuee_id: null, status: 'checked_in' },
				ctx
			);
			const member = await repo.createEvacuee(
				evInput({ first_name: 'Out', household_id: household._id, status: 'checked_out' }),
				ctx
			);
			await repo.updateEvacuee({ ...member, household_id: household._id });

			const updated = await repo.updateHousehold({
				...household,
				checkout_destination: { type: 'returned_home' }
			});

			expect(updated.status).toBe('checked_out');
			expect(updated.checkout_destination?.type).toBe('returned_home');
		});

		it('derives checked_in after Zone Arrival Confirmation on a member', async () => {
			const household = await repo.createHousehold(
				{ label: 'ครัวเรือนทดสอบ', head_evacuee_id: null, status: 'arriving' },
				ctx
			);
			const member = await repo.createEvacuee(
				evInput({ first_name: 'In', household_id: household._id, status: 'arriving' }),
				ctx
			);
			await repo.checkInEvacuee(member, ctx, 'Z1');
			const afterCheckIn = await repo.getHousehold(household._id);
			expect(afterCheckIn?.status).toBe('checked_in');

			const active = await repo.getEvacuee(member._id);
			await repo.confirmRoom(active!, ctx);
			const afterConfirm = await repo.getHousehold(household._id);
			expect(afterConfirm?.status).toBe('checked_in');
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

		it('matches a phone number with or without formatting', async () => {
			const hits = await repo.searchEvacuees('081-234-5678');
			expect(hits).toHaveLength(1);
			expect(hits[0].first_name).toBe('Somchai');
		});
	});

	describe('listEvacueesPaginated filters', () => {
		it('filters by supported vulnerable type and assigned zone before pagination', async () => {
			const elderly = await repo.createEvacuee(
				evInput({ first_name: 'Elder', special_needs: ['elderly'] }),
				ctx
			);
			await repo.checkInEvacuee(elderly, ctx, 'Z1');
			const pregnant = await repo.createEvacuee(
				evInput({ first_name: 'Mother', special_needs: ['pregnant'] }),
				ctx
			);
			await repo.checkInEvacuee(pregnant, ctx, 'Z2');

			const result = await repo.listEvacueesPaginated(1, 10, '', {
				specialNeed: 'elderly',
				zone: 'Z1'
			});

			expect(result.total).toBe(1);
			expect(result.items[0].first_name).toBe('Elder');
		});

		it('filters by stay status and returns matching ids', async () => {
			const waiting = await repo.createEvacuee(evInput({ first_name: 'Waiting' }), ctx);
			const active = await repo.createEvacuee(evInput({ first_name: 'Active' }), ctx);
			await repo.checkInEvacuee(active, ctx, 'zone-a');

			const result = await repo.listEvacueesPaginated(1, 10, '', { status: 'pre_registered' });
			expect(result.items.map((e) => e._id)).toEqual([waiting._id]);

			const ids = await repo.listMatchingEvacueeIds('', { status: 'active' });
			expect(ids).toEqual([active._id]);
		});
	});

	describe('listHouseholdsPaginated status filter', () => {
		it('filters households by status and returns matching ids', async () => {
			const a = await repo.createEvacuee(evInput({ first_name: 'A' }), ctx);
			const b = await repo.createEvacuee(evInput({ first_name: 'B' }), ctx);
			const pre = await repo.createHousehold(
				{
					label: 'Pre',
					head_evacuee_id: a._id,
					status: 'pre_registered',
					municipality_zone: null,
					community: null,
					pets: [],
					vehicles: []
				},
				ctx
			);
			const arriving = await repo.createHousehold(
				{
					label: 'Arriving',
					head_evacuee_id: b._id,
					status: 'arriving',
					municipality_zone: null,
					community: null,
					pets: [],
					vehicles: []
				},
				ctx
			);

			const result = await repo.listHouseholdsPaginated(1, 10, '', undefined, {
				status: 'pre_registered'
			});
			expect(result.items.map((h) => h._id)).toEqual([pre._id]);

			const ids = await repo.listMatchingHouseholdIds('', undefined, { status: 'arriving' });
			expect(ids).toEqual([arriving._id]);
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
			await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

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

			await repo.checkInEvacuee(linked, ctx, 'zone-a');

			const promoted = await repo.getHousehold(household._id);
			expect(promoted?.status).toBe('checked_in');
			expect(promoted?.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
		});

		it('successfully checks in a pre-registered evacuee from kiosk and sets zone', async () => {
			const kioskEvacuee = await repo.createEvacuee(
				evInput({ first_name: 'บัตร', last_name: 'สแกน', registered_via: 'kiosk' }),
				ctx
			);

			const checkedIn = await repo.checkInEvacuee(kioskEvacuee, ctx, 'zone-b');
			expect(checkedIn.current_stay.status).toBe('active');
			expect(checkedIn.current_stay.zone).toBe('zone-b');

			const movements = await repo.listMovements();
			expect(movements.some((m) => m.evacuee_id === kioskEvacuee._id && m.zone === 'zone-b')).toBe(
				true
			);
		});

		it('successfully promotes an evacuee from arriving to active and updates zone', async () => {
			const arrivingEvacuee = await repo.createEvacuee(
				evInput({ first_name: 'ผู้ประสบภัย', last_name: 'รอตรวจ', status: 'arriving' }),
				ctx
			);
			expect(arrivingEvacuee.current_stay.status).toBe('arriving');

			const checkedIn = await repo.checkInEvacuee(arrivingEvacuee, ctx, 'zone-c');
			expect(checkedIn.current_stay.status).toBe('active');
			expect(checkedIn.current_stay.zone).toBe('zone-c');

			const fetched = await repo.getEvacuee(arrivingEvacuee._id);
			expect(fetched?.current_stay.status).toBe('active');
			expect(fetched?.current_stay.zone).toBe('zone-c');

			const movements = await repo.listMovements();
			expect(
				movements.some(
					(m) =>
						m.evacuee_id === arrivingEvacuee._id && m.action === 'check_in' && m.zone === 'zone-c'
				)
			).toBe(true);
		});
	});

	describe('checkOutEvacuee', () => {
		it('records a check_out movement and updates current_stay to checked_out', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			const updated = await repo.checkOutEvacuee(checkedIn, ctx, { reason: 'กลับบ้าน' });

			expect(updated.current_stay.status).toBe('checked_out');

			const movements = await repo.listMovements();
			expect(movements).toHaveLength(2);
			expect(movements[1]).toMatchObject({
				evacuee_id: evacuee._id,
				action: 'check_out',
				zone: null,
				reason: 'กลับบ้าน'
			});
		});

		it('persists the updated status so a fresh fetch reflects it', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			await repo.checkOutEvacuee(checkedIn, ctx, { reason: 'กลับบ้าน' });

			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('checked_out');
		});

		it('rejects check-out when the evacuee is not active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await expect(repo.checkOutEvacuee(evacuee, ctx, { reason: 'กลับบ้าน' })).rejects.toThrow(
				/เช็คเอาท์/
			);
			expect(await repo.listMovements()).toHaveLength(0);
		});

		it('rejects check-out without a reason', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			await expect(repo.checkOutEvacuee(checkedIn, ctx)).rejects.toThrow(/เหตุผล/);
		});

		it('allows check-out from room_confirmed with a nonempty reason', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			const confirmed = await repo.confirmRoom(checkedIn, ctx);
			const updated = await repo.checkOutEvacuee(confirmed, ctx, { reason: ' กลับบ้าน ' });
			expect(updated.current_stay.status).toBe('checked_out');
			const movements = await repo.listMovements();
			expect(movements.at(-1)).toMatchObject({
				action: 'check_out',
				reason: 'กลับบ้าน'
			});
		});
	});

	describe('confirmRoom', () => {
		it('confirms zone arrival from active to room_confirmed', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			const confirmed = await repo.confirmRoom(checkedIn, ctx);
			expect(confirmed.current_stay.status).toBe('room_confirmed');
			expect(confirmed.current_stay.zone).toBe('zone-a');

			const movements = await repo.listMovements();
			expect(
				movements.some((m) => m.action === 'confirm_room' && m.evacuee_id === evacuee._id)
			).toBe(true);
		});

		it('rejects confirm_room unless stay is active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await expect(repo.confirmRoom(evacuee, ctx)).rejects.toThrow(/ยืนยันถึงโซน/);
			expect(await repo.listMovements()).toHaveLength(0);
		});
	});

	describe('confirmRoomForHousehold', () => {
		it('bulk-confirms only pending household members (active with zone)', async () => {
			const household = await repo.createHousehold({ label: 'ครัวเรือนยืนยันโซน' }, ctx);
			const a = await repo.createEvacuee(
				evInput({ first_name: 'A', household_id: household._id }),
				ctx
			);
			const b = await repo.createEvacuee(
				evInput({ first_name: 'B', household_id: household._id }),
				ctx
			);
			const c = await repo.createEvacuee(
				evInput({ first_name: 'C', household_id: household._id }),
				ctx
			);
			const otherHh = await repo.createHousehold({ label: 'ครัวเรือนอื่น' }, ctx);
			const outsider = await repo.createEvacuee(
				evInput({ first_name: 'Out', household_id: otherHh._id }),
				ctx
			);

			const activeA = await repo.checkInEvacuee(a, ctx, 'zone-a');
			const activeB = await repo.checkInEvacuee(b, ctx, 'zone-b');
			await repo.checkInEvacuee(outsider, ctx, 'zone-x');
			// C stays pre_registered — not pending confirmation
			const alreadyConfirmed = await repo.confirmRoom(activeA, ctx);

			const all = await repo.listEvacuees();
			const confirmed = await repo.confirmRoomForHousehold(household._id, all, ctx);

			expect(confirmed).toHaveLength(1);
			expect(confirmed[0]._id).toBe(activeB._id);
			expect(confirmed[0].current_stay.status).toBe('room_confirmed');
			expect((await repo.getEvacuee(alreadyConfirmed._id))?.current_stay.status).toBe(
				'room_confirmed'
			);
			expect((await repo.getEvacuee(c._id))?.current_stay.status).toBe('pre_registered');
			expect((await repo.getEvacuee(outsider._id))?.current_stay.status).toBe('active');
		});

		it('returns empty when no household members await Zone Arrival Confirmation', async () => {
			const household = await repo.createHousehold({ label: 'ว่าง' }, ctx);
			const member = await repo.createEvacuee(evInput({ household_id: household._id }), ctx);
			const all = await repo.listEvacuees();
			const confirmed = await repo.confirmRoomForHousehold(household._id, all, ctx);
			expect(confirmed).toEqual([]);
			expect((await repo.getEvacuee(member._id))?.current_stay.status).toBe('pre_registered');
		});
	});

	describe('recordMovement', () => {
		it('records a transfer_out movement and updates current_stay to transferred', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const active = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			const updated = await repo.recordMovement(active, 'transfer_out', ctx);

			expect(updated.current_stay.status).toBe('transferred');
			expect(updated.current_stay.zone).toBe('zone-a');

			const movements = await repo.listMovements();
			expect(movements).toHaveLength(2);
			expect(movements[1]).toMatchObject({
				evacuee_id: evacuee._id,
				action: 'transfer_out',
				zone: 'zone-a'
			});
		});

		it('records a leave_temporary movement and updates current_stay to temporary_leave', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const active = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			const updated = await repo.recordMovement(active, 'leave_temporary', ctx);

			expect(updated.current_stay.status).toBe('temporary_leave');

			const movements = await repo.listMovements();
			expect(movements[1]).toMatchObject({ action: 'leave_temporary' });
		});

		it('records a return_from_leave movement and updates current_stay back to active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const active = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			const onLeave = await repo.recordMovement(active, 'leave_temporary', ctx);

			const updated = await repo.recordMovement(onLeave, 'return_from_leave', ctx);

			expect(updated.current_stay.status).toBe('active');
		});

		it('records a mark_deceased movement and updates current_stay to deceased (terminal)', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const active = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');

			const updated = await repo.recordMovement(active, 'mark_deceased', ctx);

			expect(updated.current_stay.status).toBe('deceased');
			await expect(repo.recordMovement(updated, 'transfer_out', ctx)).rejects.toThrow(/เสียชีวิต/);
		});

		it('persists the updated status so a fresh fetch reflects it', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const active = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			await repo.recordMovement(active, 'transfer_out', ctx);

			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('transferred');
		});

		it('rejects transfer_out when the evacuee is not active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await expect(repo.recordMovement(evacuee, 'transfer_out', ctx)).rejects.toThrow(/ย้ายออก/);
			expect(await repo.listMovements()).toHaveLength(0);
		});

		it('rejects leave_temporary when the evacuee is not active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await expect(repo.recordMovement(evacuee, 'leave_temporary', ctx)).rejects.toThrow(
				/ลาชั่วคราว/
			);
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
		await expect(repo.checkInEvacuee(deceased, ctx, 'zone-a')).rejects.toThrow(/เสียชีวิต/);
		expect(await repo.listMovements()).toHaveLength(0);
		const fetched = await repo.getEvacuee(evacuee._id);
		expect(fetched?.current_stay.status).toBe('pre_registered');
	});

	describe('changeEvacueeZone', () => {
		it('records zone_change and keeps status active', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			const checkedIn = await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			const updated = await repo.changeEvacueeZone(checkedIn, ctx, 'zone-b');
			expect(updated.current_stay.status).toBe('active');
			expect(updated.current_stay.zone).toBe('zone-b');
			const movements = await repo.listMovements();
			expect(movements.at(-1)).toMatchObject({
				evacuee_id: evacuee._id,
				action: 'zone_change',
				zone: 'zone-b'
			});
		});
	});

	describe('cancelPreRegistration', () => {
		it('cancels the household, cascades member stays to cancelled, and records the actor', async () => {
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
			expect(fetchedMember?.current_stay.status).toBe('cancelled');
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
					member_count: 1,
					cancelled_member_count: 1
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

	describe('cancelEvacueePreRegistration', () => {
		it('cancels a pre_registered stay and cancels the household when no members remain', async () => {
			const member = await repo.createEvacuee(evInput(), ctx);
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
			await repo.updateEvacuee({ ...member, household_id: hh._id });

			await repo.cancelEvacueePreRegistration(member._id, ctx);

			expect((await repo.getEvacuee(member._id))?.current_stay.status).toBe('cancelled');
			expect((await repo.getHousehold(hh._id))?.status).toBe('cancelled');
		});

		it('keeps household pre_registered when another member is still pre_registered', async () => {
			const a = await repo.createEvacuee(evInput({ first_name: 'A' }), ctx);
			const b = await repo.createEvacuee(evInput({ first_name: 'B' }), ctx);
			const hh = await repo.createHousehold(
				{
					label: 'บ้านทดสอบ',
					head_evacuee_id: a._id,
					status: 'pre_registered',
					municipality_zone: null,
					community: null,
					pets: [],
					vehicles: []
				},
				ctx
			);
			await repo.updateEvacuee({ ...a, household_id: hh._id });
			await repo.updateEvacuee({ ...b, household_id: hh._id });

			await repo.cancelEvacueePreRegistration(a._id, ctx);

			expect((await repo.getEvacuee(a._id))?.current_stay.status).toBe('cancelled');
			expect((await repo.getEvacuee(b._id))?.current_stay.status).toBe('pre_registered');
			expect((await repo.getHousehold(hh._id))?.status).toBe('pre_registered');
		});

		it('throws when stay is not pre_registered', async () => {
			const evacuee = await repo.createEvacuee(evInput(), ctx);
			await repo.checkInEvacuee(evacuee, ctx, 'zone-a');
			await expect(repo.cancelEvacueePreRegistration(evacuee._id, ctx)).rejects.toThrow(
				/สามารถยกเลิกได้เฉพาะ/
			);
		});
	});

	describe('createEvacueeWithScreening', () => {
		it('persists both evacuee and screening', async () => {
			const { evacuee, screening } = await repo.createEvacueeWithScreening(
				evInput(),
				{ symptoms: [], temperature_c: null, track: 'normal', needs_referral: false },
				ctx
			);
			expect(evacuee._id).toMatch(/^evacuee:/);
			expect(screening.evacuee_id).toBe(evacuee._id);
			expect(await repo.getEvacuee(evacuee._id)).not.toBeNull();
		});

		it('rolls back the evacuee when screening write fails', async () => {
			const originalPut = memoryRepo.put.bind(memoryRepo);
			memoryRepo.put = async (doc) => {
				if ((doc as { type?: string }).type === 'screening') {
					throw new Error('doc type not allowed yet: screening');
				}
				return originalPut(doc);
			};

			await expect(
				repo.createEvacueeWithScreening(
					evInput({ first_name: 'Rollback' }),
					{ symptoms: ['fever'], temperature_c: null, track: 'fast_track', needs_referral: false },
					ctx
				)
			).rejects.toThrow(/doc type not allowed yet: screening/);

			const leftover = (await repo.listEvacuees()).filter((e) => e.first_name === 'Rollback');
			expect(leftover).toHaveLength(0);
		});

		it('rolls back medical when screening fails after medical was written', async () => {
			const originalPut = memoryRepo.put.bind(memoryRepo);
			memoryRepo.put = async (doc) => {
				if ((doc as { type?: string }).type === 'screening') {
					throw new Error('doc type not allowed yet: screening');
				}
				return originalPut(doc);
			};

			await expect(
				repo.createEvacueeWithScreening(
					evInput({
						first_name: 'MedRollback',
						medical_conditions: ['diabetes']
					}),
					{ symptoms: [], temperature_c: null, track: 'normal', needs_referral: false },
					ctx
				)
			).rejects.toThrow(/doc type not allowed yet: screening/);

			expect(
				(await repo.listEvacuees()).filter((e) => e.first_name === 'MedRollback')
			).toHaveLength(0);
			expect(await repo.listMedicals()).toHaveLength(0);
		});
	});

	describe('getPendingScreeningEvacuees', () => {
		it('returns arriving and pre_registered evacuees without screening, excluding screened and other statuses', async () => {
			// 1. Evacuee arriving without screening -> SHOULD be included
			const eArriving = await repo.createEvacuee(
				evInput({ first_name: 'ArrivingNoScreen', status: 'arriving' }),
				ctx
			);

			// 2. Evacuee pre_registered without screening -> SHOULD be included
			const ePreReg = await repo.createEvacuee(
				evInput({ first_name: 'PreRegNoScreen', status: 'pre_registered' }),
				ctx
			);

			// 3. Evacuee arriving WITH screening -> SHOULD be excluded
			const eArrivingScreened = await repo.createEvacuee(
				evInput({ first_name: 'ArrivingScreened', status: 'arriving' }),
				ctx
			);
			await repo.createScreening(
				{
					evacuee_id: eArrivingScreened._id,
					symptoms: [],
					temperature_c: 36.5,
					track: 'normal',
					needs_referral: false
				},
				ctx
			);

			// 4. Evacuee active (checked in) without screening -> SHOULD be excluded
			const eActive = await repo.createEvacuee(
				evInput({ first_name: 'ActiveNoScreen', status: 'active' }),
				ctx
			);

			// 5. Evacuee cancelled without screening -> SHOULD be excluded
			await repo.createEvacuee(
				evInput({ first_name: 'CancelledNoScreen', status: 'cancelled' }),
				ctx
			);

			// 6. Evacuee in different shelter -> SHOULD be excluded when filtering by SH001
			await repo.createEvacuee(evInput({ first_name: 'OtherShelter' }), {
				shelterCode: 'SH002',
				createdBy: 'tester'
			});

			const pending = await repo.getPendingScreeningEvacuees('SH001');
			const pendingIds = pending.map((e) => e._id);

			expect(pendingIds).toContain(eArriving._id);
			expect(pendingIds).toContain(ePreReg._id);
			expect(pendingIds).not.toContain(eArrivingScreened._id);
			expect(pendingIds).not.toContain(eActive._id);
			expect(pending.some((e) => e.first_name === 'CancelledNoScreen')).toBe(false);
			expect(pending.some((e) => e.first_name === 'OtherShelter')).toBe(false);
		});
	});

	describe('recordMedicalScreening', () => {
		it('creates screening doc without check-in when checkIn is false or omitted', async () => {
			const evacuee = await repo.createEvacuee(
				evInput({ first_name: 'Somchai', status: 'arriving' }),
				ctx
			);

			const result = await repo.recordMedicalScreening(
				{
					screening: {
						evacuee_id: evacuee._id,
						track: 'normal',
						triage_level: 'green',
						symptoms: ['headache'],
						temperature_c: 36.8,
						blood_pressure_sys: 118,
						blood_pressure_dia: 78,
						heart_rate: 72,
						spo2_percent: 99
					},
					checkIn: false
				},
				ctx
			);

			expect(result.screening).toBeDefined();
			expect(result.screening.schema_v).toBe(2);
			expect(result.screening.triage_level).toBe('green');
			expect(result.screening.vital_signs).toEqual({
				blood_pressure_sys: 118,
				blood_pressure_dia: 78,
				heart_rate: 72,
				spo2_percent: 99
			});
			expect(result.evacuee).toBeUndefined();

			// Evacuee remains arriving
			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('arriving');
			expect(fetched?.current_stay.zone).toBeNull();
		});

		it('creates screening doc and checks in evacuee to active when checkIn is true with zone', async () => {
			const evacuee = await repo.createEvacuee(
				evInput({ first_name: 'Wichai', status: 'arriving' }),
				ctx
			);

			const result = await repo.recordMedicalScreening(
				{
					screening: {
						evacuee_id: evacuee._id,
						track: 'fast_track',
						triage_level: 'yellow',
						symptoms: ['cough', 'fever'],
						temperature_c: 38.2
					},
					checkIn: true,
					zone: 'Zone-Yellow-1'
				},
				ctx
			);

			expect(result.screening).toBeDefined();
			expect(result.screening.schema_v).toBe(2);
			expect(result.screening.triage_level).toBe('yellow');

			expect(result.evacuee).toBeDefined();
			expect(result.evacuee?.current_stay.status).toBe('active');
			expect(result.evacuee?.current_stay.zone).toBe('Zone-Yellow-1');

			// Check persisted evacuee
			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('active');
			expect(fetched?.current_stay.zone).toBe('Zone-Yellow-1');

			// Movement record exists
			const movements = await repo.listMovements();
			const checkInMov = movements.find(
				(m) => m.evacuee_id === evacuee._id && m.action === 'check_in'
			);
			expect(checkInMov).toBeDefined();
			expect(checkInMov?.zone).toBe('Zone-Yellow-1');
		});

		it('syncs clinical medical profile when medical payload is provided', async () => {
			const evacuee = await repo.createEvacuee(
				evInput({ first_name: 'Mali', status: 'arriving' }),
				ctx
			);

			const result = await repo.recordMedicalScreening(
				{
					screening: {
						evacuee_id: evacuee._id,
						track: 'normal',
						triage_level: 'green',
						symptoms: [],
						temperature_c: 36.5
					},
					checkIn: false,
					medical: {
						evacuee_id: evacuee._id,
						blood_group: 'A',
						conditions: ['diabetes'],
						medications: ['metformin'],
						allergies: ['penicillin'],
						track: 'normal',
						notes: 'baseline from screening desk'
					}
				},
				ctx
			);

			expect(result.medical).toBeDefined();
			expect(result.medical?.blood_group).toBe('A');
			expect(result.medical?.conditions).toEqual(['diabetes']);
			expect(result.medical?.medications).toEqual(['metformin']);
			expect(result.medical?.allergies).toEqual(['penicillin']);
			expect(result.medical?.notes).toBe('baseline from screening desk');

			const medicals = await repo.listMedicals();
			const linked = medicals.find((m) => m.evacuee_id === evacuee._id);
			expect(linked).toBeDefined();
			expect(linked?.blood_group).toBe('A');
			expect(linked?.conditions).toEqual(['diabetes']);
		});

		it('updates existing medical profile instead of creating a duplicate', async () => {
			const evacuee = await repo.createEvacuee(
				evInput({ first_name: 'Dao', status: 'arriving' }),
				ctx
			);
			await repo.createMedical(
				{
					evacuee_id: evacuee._id,
					blood_group: 'O',
					conditions: ['hypertension'],
					medications: [],
					allergies: [],
					track: 'normal'
				},
				ctx
			);

			const result = await repo.recordMedicalScreening(
				{
					screening: {
						evacuee_id: evacuee._id,
						track: 'normal',
						triage_level: 'yellow',
						symptoms: ['fever']
					},
					medical: {
						evacuee_id: evacuee._id,
						blood_group: 'B',
						conditions: ['hypertension', 'asthma'],
						medications: ['inhaler'],
						allergies: ['seafood'],
						track: 'fast_track',
						notes: 'updated at medical screening'
					}
				},
				ctx
			);

			expect(result.medical?.blood_group).toBe('B');
			expect(result.medical?.conditions).toEqual(['hypertension', 'asthma']);
			expect(result.medical?.track).toBe('fast_track');

			const medicals = await repo.listMedicals();
			expect(medicals.filter((m) => m.evacuee_id === evacuee._id)).toHaveLength(1);
		});

		it('assigns isolation zone on direct check-in without severing household link', async () => {
			const household = await repo.createHousehold(
				{ label: 'บ้านร่วม', head_evacuee_id: null, status: 'arriving' },
				ctx
			);
			const infectious = await repo.createEvacuee(
				evInput({
					first_name: 'Infectious',
					status: 'arriving',
					household_id: household._id
				}),
				ctx
			);
			const roommate = await repo.createEvacuee(
				evInput({
					first_name: 'Roommate',
					status: 'arriving',
					household_id: household._id
				}),
				ctx
			);

			const result = await repo.recordMedicalScreening(
				{
					screening: {
						evacuee_id: infectious._id,
						track: 'fast_track',
						triage_level: 'red',
						symptoms: ['acute_watery_diarrhea'],
						temperature_c: 39.1,
						needs_referral: false
					},
					checkIn: true,
					zone: 'ISO-Medical-1'
				},
				ctx
			);

			expect(result.evacuee?.current_stay.status).toBe('active');
			expect(result.evacuee?.current_stay.zone).toBe('ISO-Medical-1');
			expect(result.evacuee?.household_id).toBe(household._id);

			const fetchedInfectious = await repo.getEvacuee(infectious._id);
			expect(fetchedInfectious?.household_id).toBe(household._id);
			expect(fetchedInfectious?.current_stay.zone).toBe('ISO-Medical-1');

			const fetchedRoommate = await repo.getEvacuee(roommate._id);
			expect(fetchedRoommate?.household_id).toBe(household._id);
			expect(fetchedRoommate?.current_stay.status).toBe('arriving');
			expect(fetchedRoommate?.current_stay.zone).toBeNull();
		});
	});

	describe('promoteReportIn', () => {
		it('promotes pre_registered to arriving with zone null and creates no screening', async () => {
			const evacuee = await repo.createEvacuee(evInput({ first_name: 'Report' }), ctx);
			expect(evacuee.current_stay.status).toBe('pre_registered');

			const promoted = await repo.promoteReportIn(evacuee._id);

			expect(promoted.current_stay.status).toBe('arriving');
			expect(promoted.current_stay.zone).toBeNull();

			const fetched = await repo.getEvacuee(evacuee._id);
			expect(fetched?.current_stay.status).toBe('arriving');
			expect(fetched?.current_stay.zone).toBeNull();
			expect(await repo.listScreenings()).toHaveLength(0);
		});

		it('rejects Report-in when stay status is not pre_registered', async () => {
			const arriving = await repo.createEvacuee(
				evInput({ first_name: 'Already', status: 'arriving' }),
				ctx
			);
			await expect(repo.promoteReportIn(arriving._id)).rejects.toThrow(/pre_registered/);
			expect((await repo.getEvacuee(arriving._id))?.current_stay.status).toBe('arriving');
		});

		it('promotes linked pre_registered household to arriving', async () => {
			const head = await repo.createEvacuee(evInput({ first_name: 'Head' }), ctx);
			const household = await repo.createHousehold(
				{
					label: 'HH Report-in',
					head_evacuee_id: head._id,
					status: 'pre_registered'
				},
				ctx
			);
			await repo.updateEvacuee({ ...head, household_id: household._id });

			await repo.promoteReportIn(head._id);

			const hh = await repo.getHousehold(household._id);
			expect(hh?.status).toBe('arriving');
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
