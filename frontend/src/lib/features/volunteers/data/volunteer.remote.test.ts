import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { AuthorContext } from '$lib/db/model';
import { sha256Hex } from '$lib/db/hash';

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { createVolunteerRepositoryForTest } from './volunteer.remote';
import type { VolunteerInput } from '../domain/volunteer.schema';
import { VolunteerPhoneTakenError } from '../domain/phone-errors';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

const baseInput: VolunteerInput = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	skills: ['ขับรถ'],
	source: 'walk_in',
	national_id: null
};

describe('VolunteerRemoteRepository', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
	});

	it('mints sequential volunteer_code starting at V-001', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const first = await repo.create(baseInput, ctx);
		const second = await repo.create(
			{ ...baseInput, first_name: 'สมหญิง', phone: '0823456789' },
			ctx
		);

		expect(first.volunteer_code).toBe('V-001');
		expect(second.volunteer_code).toBe('V-002');
	});

	it('stamps envelope defaults from makeVolunteer (checked_in=false, identity_verified=false)', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const volunteer = await repo.create(baseInput, ctx);

		expect(volunteer._id).toMatch(/^volunteer:/);
		expect(volunteer.schema_v).toBe(6);
		expect(volunteer.checked_in).toBe(false);
		expect(volunteer.identity_verified).toBe(false);
		expect(volunteer.current_shelter_code).toBeNull();
		expect(volunteer.status).toBe('active');
	});

	it('mints phone and tracking hashes for fast-track walk-ins before any job is selected', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const volunteer = await repo.create(baseInput, ctx);

		expect(volunteer.phone_hash).toBe(await sha256Hex('0812345678'));
		expect(volunteer.tracking_token_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(volunteer.tracking_token).toBeNull();
	});

	it('list() filters by status/source/checkedIn', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		await repo.create({ ...baseInput, phone: '0811111111' }, ctx, { status: 'active' });
		await repo.create({ ...baseInput, phone: '0822222222', source: 'public_apply' }, ctx, {
			status: 'inactive'
		});

		expect((await repo.list({ status: 'inactive' })).length).toBe(1);
		expect((await repo.list({ source: 'public_apply' })).length).toBe(1);
		expect((await repo.list()).length).toBe(2);
	});

	it('setCheckedIn flips checked_in + current_shelter_code with a fresh _rev', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		const checkedIn = await repo.setCheckedIn(created._id, true, 'SH001');
		expect(checkedIn.checked_in).toBe(true);
		expect(checkedIn.current_shelter_code).toBe('SH001');
		expect(checkedIn._rev).not.toBe(created._rev);

		const checkedOut = await repo.setCheckedIn(created._id, false, null);
		expect(checkedOut.checked_in).toBe(false);
		expect(checkedOut.current_shelter_code).toBeNull();
	});

	it('records identity and controlled-skill review separately from profile edits', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create({ ...baseInput, skills: ['medical'] }, ctx);

		const identityReviewed = await repo.reviewIdentity(
			created._id,
			'verified',
			'manager-1',
			'ตรวจบัตรแล้ว'
		);
		expect(identityReviewed.identity_verified).toBe(true);
		expect(identityReviewed.identity_verification).toMatchObject({
			status: 'verified',
			reviewed_by: 'manager-1'
		});

		const skillReviewed = await repo.reviewSkill(
			created._id,
			'medical',
			'verified',
			'manager-1',
			'ตรวจใบรับรองแล้ว',
			'พย.12345'
		);
		expect(skillReviewed.skill_verifications?.medical).toMatchObject({
			status: 'verified',
			reviewed_by: 'manager-1',
			credential_reference: 'พย.12345'
		});
	});

	describe("accepting another shelter's result (CR-228)", () => {
		const fromSh001 = { shelter_code: 'SH001', verified_at: '2026-11-01T03:00:00.000Z' };

		it('marks an accepted identity and skill with accepted_from and stamps schema_v 6', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh002');
			const created = await repo.create({ ...baseInput, skills: ['medical'] }, ctx);

			const identity = await repo.reviewIdentity(created._id, 'verified', 'sm02', null, fromSh001);
			expect(identity.schema_v).toBe(6);
			expect(identity.identity_verified).toBe(true);
			expect(identity.identity_verification).toMatchObject({
				status: 'verified',
				reviewed_by: 'sm02',
				notes: null,
				accepted_from: fromSh001
			});

			const skill = await repo.reviewSkill(
				created._id,
				'medical',
				'verified',
				'sm02',
				null,
				'ว.555',
				{ shelter_code: 'SH001', verified_at: null }
			);
			expect(skill.skill_verifications?.medical).toEqual({
				status: 'verified',
				reviewed_at: expect.any(String),
				reviewed_by: 'sm02',
				notes: null,
				credential_reference: 'ว.555',
				accepted_from: { shelter_code: 'SH001', verified_at: null }
			});
		});

		it('drops the mark when the result is checked again at this shelter', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh002');
			const created = await repo.create({ ...baseInput, skills: ['medical'] }, ctx);
			await repo.reviewIdentity(created._id, 'verified', 'sm02', null, fromSh001);
			await repo.reviewSkill(created._id, 'medical', 'verified', 'sm02', null, null, fromSh001);

			const identity = await repo.reviewIdentity(created._id, 'verified', 'sm02', 'ตรวจบัตรเอง');
			expect(identity.identity_verification?.accepted_from).toBeUndefined();
			const skill = await repo.reviewSkill(created._id, 'medical', 'verified', 'sm02', null, null);
			expect(skill.skill_verifications?.medical.accepted_from).toBeUndefined();
		});
	});

	it('getByTrackingToken returns null and listByPhoneHash returns empty array when absent', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		expect(await repo.getByTrackingToken('missing')).toBeNull();
		expect(await repo.listByPhoneHash('missing')).toEqual([]);
	});

	it('getByTrackingToken queries by the hashed, normalized token (trimmed + upper-cased before hashing), with a legacy plaintext fallback — mirrors job-application.remote.ts#getByTrackingToken', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const findSpy = vi.spyOn(memoryRepo, 'find');
		const rawToken = '  tkt-vol-abc123  ';

		await repo.getByTrackingToken(rawToken);

		const expectedHash = await sha256Hex('TKT-VOL-ABC123');
		expect(findSpy).toHaveBeenCalledWith({
			selector: {
				type: 'volunteer',
				$or: [{ tracking_token_hash: expectedHash }, { tracking_token: rawToken }]
			},
			limit: 1
		});
	});

	it('getByTrackingToken compares a hash-backed role-card payload directly with volunteer.tracking_token_hash', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const findSpy = vi.spyOn(memoryRepo, 'find');
		const hash = 'b'.repeat(64);

		await repo.getByTrackingToken(`TKT-VOL-HASH-${hash}`);

		expect(findSpy).toHaveBeenCalledWith({
			selector: {
				type: 'volunteer',
				$or: [{ tracking_token_hash: hash }, { tracking_token: `TKT-VOL-HASH-${hash}` }]
			},
			limit: 1
		});
	});

	it('update() throws for a document that does not exist', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);
		await expect(repo.update({ ...created, _id: 'volunteer:missing' })).rejects.toThrow(
			'ไม่พบข้อมูลอาสาสมัคร'
		);
	});

	describe('update() phone_hash', () => {
		it('finds the volunteer by the new phone and no longer by the old phone after the phone is edited', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const created = await repo.create(baseInput, ctx);

			const updated = await repo.update({ ...created, phone: '0898765432' });

			expect(updated.phone_hash).toBe(await sha256Hex('0898765432'));
			const found = await repo.listByPhoneHash(await sha256Hex('0898765432'));
			expect(found[0]?._id).toBe(created._id);
			expect(await repo.listByPhoneHash(await sha256Hex('0812345678'))).toEqual([]);
		});

		it('clears phone_hash when the phone is removed', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const created = await repo.create(baseInput, ctx);

			const updated = await repo.update({ ...created, phone: null });

			expect(updated.phone_hash).toBeNull();
			expect(await repo.listByPhoneHash(await sha256Hex('0812345678'))).toEqual([]);
		});

		it('clears phone_hash when the phone is only whitespace', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const created = await repo.create(baseInput, ctx);

			const updated = await repo.update({ ...created, phone: '   ' });

			expect(updated.phone_hash).toBeNull();
		});

		it('hashes an edited +66 phone the same as its 0-prefixed form', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const created = await repo.create(baseInput, ctx);

			await repo.update({ ...created, phone: '+66 89-876-5432' });

			const found = await repo.listByPhoneHash(await sha256Hex('0898765432'));
			expect(found[0]?._id).toBe(created._id);
		});

		it('keeps phone_hash when another field changes and the phone stays the same', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const created = await repo.create(baseInput, ctx);

			const updated = await repo.update({ ...created, first_name: 'สมศักดิ์' });

			expect(updated.phone_hash).toBe(await sha256Hex('0812345678'));
			const found = await repo.listByPhoneHash(await sha256Hex('0812345678'));
			expect(found[0]?._id).toBe(created._id);
		});
	});

	describe('phone uniqueness per shelter (CR-239)', () => {
		it('create() throws VolunteerPhoneTakenError when phone number already exists', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const existing = await repo.create(baseInput, ctx);

			await expect(
				repo.create({ ...baseInput, first_name: 'สมศรี', last_name: 'ใจงาม' }, ctx)
			).rejects.toThrow(VolunteerPhoneTakenError);

			try {
				await repo.create({ ...baseInput, first_name: 'สมศรี', last_name: 'ใจงาม' }, ctx);
			} catch (err) {
				expect(err).toBeInstanceOf(VolunteerPhoneTakenError);
				const taken = err as VolunteerPhoneTakenError;
				expect(taken.existing[0]._id).toBe(existing._id);
				expect(taken.existing[0].volunteer_code).toBe(existing.volunteer_code);
				expect(taken.message).toContain('เบอร์นี้มีอยู่แล้วในศูนย์');
			}
		});

		it.each(['+66 81-234-5678', '081-234-5678', '66812345678'])(
			'create() treats %s as the same number as 0812345678 (AC-1, FR-1)',
			async (variant) => {
				const repo = createVolunteerRepositoryForTest('shelter_sh001');
				await repo.create(baseInput, ctx);

				await expect(
					repo.create({ ...baseInput, first_name: 'สมศรี', phone: variant }, ctx)
				).rejects.toThrow(VolunteerPhoneTakenError);
			}
		);

		it('update() saves a profile that keeps its own phone (AC-5, FR-8)', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const created = await repo.create(baseInput, ctx);

			const updated = await repo.update({ ...created, phone: '081-234-5678' });

			expect(updated._id).toBe(created._id);
		});

		describe('profiles that already share a phone (pre-#708 data)', () => {
			/** Two profiles with the same phone, written straight into the store (create() would block it). */
			async function seedSharedPhone() {
				const repo = createVolunteerRepositoryForTest('shelter_sh001');
				const a = await repo.create(baseInput, ctx);
				const b = await repo.create(
					{ ...baseInput, first_name: 'สมหญิง', phone: '0899999999' },
					ctx
				);
				const bLegacy = await memoryRepo.put({ ...b, phone: '0812345678', phone_hash: null });
				return { repo, a, b: bLegacy };
			}

			it('listByPhoneHash returns both profiles that share a hash (AC-6)', async () => {
				const { repo, a, b } = await seedSharedPhone();
				await memoryRepo.put({ ...b, phone_hash: await sha256Hex('0812345678') });
				const found = await repo.listByPhoneHash(await sha256Hex('0812345678'));
				expect(found.map((v) => v._id).sort()).toEqual([a._id, b._id].sort());
			});

			it('renaming a profile with a null phone_hash whose phone is already taken succeeds (AC-5, FR-8)', async () => {
				const { repo, b } = await seedSharedPhone();
				const updated = await repo.update({ ...b, first_name: 'ชื่อใหม่' });
				expect(updated.first_name).toBe('ชื่อใหม่');
				expect(updated.phone_hash).toBe(await sha256Hex('0812345678'));
			});

			it('renaming the profile that holds the stored hash still succeeds even though another shares it', async () => {
				const { repo, a, b } = await seedSharedPhone();
				await memoryRepo.put({ ...b, phone_hash: await sha256Hex('0812345678') });
				const updated = await repo.update({ ...a, first_name: 'ชื่อใหม่' });
				expect(updated.first_name).toBe('ชื่อใหม่');
			});

			it('changing the phone of a legacy profile to a number another profile holds is rejected', async () => {
				const { repo, b } = await seedSharedPhone();
				const other = await repo.create(
					{ ...baseInput, first_name: 'คนที่สาม', phone: '0877777777' },
					ctx
				);
				await expect(repo.update({ ...b, phone: other.phone })).rejects.toThrow(
					VolunteerPhoneTakenError
				);
			});
		});

		it('create() allows creating multiple volunteers without a phone (null phone)', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const v1 = await repo.create({ ...baseInput, phone: null }, ctx);
			const v2 = await repo.create({ ...baseInput, first_name: 'สมหญิง', phone: null }, ctx);

			expect(v1._id).not.toBe(v2._id);
			expect(v1.phone).toBeNull();
			expect(v2.phone).toBeNull();
		});

		it('create() rejects duplicates even if existing profile is inactive (FR-2)', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const existing = await repo.create(baseInput, ctx, { status: 'inactive' });
			expect(existing.status).toBe('inactive');

			await expect(
				repo.create({ ...baseInput, first_name: 'สมศรี', last_name: 'ใจงาม' }, ctx)
			).rejects.toThrow(VolunteerPhoneTakenError);

			try {
				await repo.create({ ...baseInput, first_name: 'สมศรี', last_name: 'ใจงาม' }, ctx);
			} catch (err) {
				const taken = err as VolunteerPhoneTakenError;
				expect(taken.message).toContain('(ปิดใช้งานอยู่)');
			}
		});

		it('create() ignores profiles that have merged_into flag (FR-5)', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const v1 = await repo.create(baseInput, ctx);
			// Simulate merged profile
			await memoryRepo.put({ ...v1, merged_into: 'volunteer:canonical' });

			// Creating new volunteer with the same phone should now succeed because v1 was merged
			const v2 = await repo.create({ ...baseInput, first_name: 'สมศรี' }, ctx);
			expect(v2._id).toBeDefined();
		});

		it('update() throws VolunteerPhoneTakenError when changing phone to one that already exists', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			await repo.create({ ...baseInput, phone: '0811111111' }, ctx);
			const v2 = await repo.create({ ...baseInput, phone: '0822222222' }, ctx);

			await expect(repo.update({ ...v2, phone: '0811111111' })).rejects.toThrow(
				VolunteerPhoneTakenError
			);
		});

		it('update() preserves merged_* metadata on update (FR-6)', async () => {
			const repo = createVolunteerRepositoryForTest('shelter_sh001');
			const v1 = await repo.create(baseInput, ctx);
			await memoryRepo.put({
				...v1,
				merged_into: 'volunteer:canonical',
				merged_at: '2026-11-08T00:00:00.000Z',
				merged_by: 'admin',
				migration_run_id: 'run-1'
			});

			const updated = await repo.update({ ...v1, first_name: 'ชื่อใหม่' });
			expect(updated.merged_into).toBe('volunteer:canonical');
			expect(updated.merged_at).toBe('2026-11-08T00:00:00.000Z');
			expect(updated.merged_by).toBe('admin');
			expect(updated.migration_run_id).toBe('run-1');
		});
	});

	it('deactivate() marks a volunteer inactive and preserves the profile', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		const deactivated = await repo.deactivate(created._id);

		expect(deactivated.status).toBe('inactive');
		expect(deactivated._rev).not.toBe(created._rev);
		expect(await repo.get(created._id)).toMatchObject({
			_id: created._id,
			status: 'inactive'
		});
	});

	it('reactivate() marks an inactive volunteer active again', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);
		await repo.deactivate(created._id);

		const reactivated = await repo.reactivate(created._id);

		expect(reactivated.status).toBe('active');
		expect(await repo.get(created._id)).toMatchObject({ _id: created._id, status: 'active' });
	});

	it('reactivate() throws for a document that does not exist', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');

		await expect(repo.reactivate('volunteer:missing')).rejects.toThrow('ไม่พบข้อมูลอาสาสมัคร');
	});

	it('deactivate() throws for a document that does not exist', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');

		await expect(repo.deactivate('volunteer:missing')).rejects.toThrow('ไม่พบข้อมูลอาสาสมัคร');
	});
});
