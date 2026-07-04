// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';
import { createInitialProfile, createNewVersion } from '../domain/sop-ratio';
import {
	SopMasterPouchRepository,
	SopOverridePouchRepository,
	resolveEffectiveRatios,
	sopMasterRepository,
	sopOverrideRepository,
	clearSopMasterCache,
	clearSopOverrideCache,
	createSopMasterRepositoryForTest,
	createSopOverrideRepositoryForTest
} from './sop-ratio.pouch';
import type { AuthorContext } from '$lib/db/model';
import type { AuditEntry } from '$lib/features/shared';

PouchDB.plugin(memory);

const masterCtx = { createdBy: 'tester' };
const overrideCtx: AuthorContext & { base_profile_id: string } = {
	shelterCode: 'SH001',
	createdBy: 'tester',
	base_profile_id: 'sop_profile:base-id'
};

const validRatios = {
	water_l_per_person_day: 15,
	drinking_water_l_per_person_day: 3,
	cooking_water_l_per_person_day: 6,
	hygiene_water_l_per_person_day: 6,
	kcal_per_adult_day: 2000,
	people_per_tap: 80,
	people_per_handpump: 500,
	people_per_open_well: 400,
	people_per_laundry: 100,
	people_per_bathing: 50,
	people_per_toilet_female: 20,
	people_per_toilet_male: 35,
	people_per_dining_point_adult: 20,
	people_per_dining_point_child: 10,
	m2_per_person_living: 3.5,
	m2_per_person_living_cold: 4.5,
	m2_per_person_total: 45,
	max_waterpoint_distance_m: 500,
	max_queue_minutes: 30,
	people_per_volunteer: 50
};

describe('SopMasterPouchRepository', () => {
	let db: PouchDB.Database;
	let repo: SopMasterPouchRepository;

	beforeEach(() => {
		db = new PouchDB(`test-sop-master-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		repo = createSopMasterRepositoryForTest(db);
	});

	afterEach(async () => {
		if (db) await db.destroy();
	});

	it('should list only active master profiles', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			validRatios,
			masterCtx
		);
		const { profile: p2, audit: a2 } = createInitialProfile(
			'sop_profile',
			'Thai Red Cross',
			{ ...validRatios, water_l_per_person_day: 20 },
			masterCtx
		);

		await repo.createVersion(null, p1, a1);
		await repo.createVersion(null, p2, a2);

		const savedP2 = await repo.getById(p2._id);
		const {
			deactivatedPrev,
			profile: p2v2,
			audit: a3
		} = createNewVersion(savedP2!, { water_l_per_person_day: 25 }, 'Update to 25', masterCtx);

		await repo.createVersion(deactivatedPrev, p2v2, a3);

		const active = await repo.listActive();
		expect(active).toHaveLength(2);
		expect(active.map((p) => p.name)).toContain('Sphere Baseline');
		expect(active.map((p) => p.name)).toContain('Thai Red Cross');
		expect(active.find((p) => p.name === 'Thai Red Cross')?.version).toBe(2);
	});

	it('should list all versions of a master profile by name', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			validRatios,
			masterCtx
		);
		await repo.createVersion(null, p1, a1);

		const savedP1 = await repo.getById(p1._id);
		const {
			deactivatedPrev,
			profile: p1v2,
			audit: a2
		} = createNewVersion(savedP1!, { water_l_per_person_day: 20 }, 'Increase water', masterCtx);
		const { profile: p2, audit: a3 } = createInitialProfile(
			'sop_profile',
			'Different Name',
			{ ...validRatios, water_l_per_person_day: 10 },
			masterCtx
		);

		await repo.createVersion(deactivatedPrev, p1v2, a2);
		await repo.createVersion(null, p2, a3);

		const versions = await repo.listVersions('Sphere Baseline');
		expect(versions).toHaveLength(2);
		expect(versions.map((v) => v.version)).toContain(1);
		expect(versions.map((v) => v.version)).toContain(2);
	});

	it('should get a master profile by ID and return null for missing ones', async () => {
		const { profile, audit } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			validRatios,
			masterCtx
		);
		await repo.createVersion(null, profile, audit);

		const fetched = await repo.getById(profile._id);
		expect(fetched).not.toBeNull();
		expect(fetched?.name).toBe('Sphere Baseline');

		const missing = await repo.getById('sop_profile:non-existent');
		expect(missing).toBeNull();
	});

	it('should create a new master version atomically with audit trail', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			validRatios,
			masterCtx
		);
		const { profile: savedP1 } = await repo.createVersion(null, p1, a1);

		const {
			deactivatedPrev,
			profile: p1v2,
			audit: a2
		} = createNewVersion(savedP1, { water_l_per_person_day: 18 }, 'Manual adjust', masterCtx);

		await repo.createVersion(deactivatedPrev, p1v2, a2);

		const oldDoc = await repo.getById(p1._id);
		const newDoc = await repo.getById(p1v2._id);
		const auditDoc = await db.get<AuditEntry>(a2!._id);

		expect(oldDoc?.active).toBe(false);
		expect(newDoc?.active).toBe(true);
		expect(newDoc?.version).toBe(2);
		expect(newDoc?.ratios.water_l_per_person_day).toBe(18);
		expect(auditDoc.action).toBe('manual_adjust');
		expect(auditDoc.target_id).toBe(p1v2._id);
	});

	it('should set a master version to active and deactivate others of the same name', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			validRatios,
			masterCtx
		);
		await repo.createVersion(null, p1, a1);

		const savedP1 = await repo.getById(p1._id);
		const {
			deactivatedPrev,
			profile: p1v2,
			audit: a2
		} = createNewVersion(savedP1!, { water_l_per_person_day: 18 }, 'Manual adjust', masterCtx);

		await repo.createVersion(deactivatedPrev, p1v2, a2);

		await repo.setActive(p1._id, masterCtx);

		const rolledBackP1 = await repo.getById(p1._id);
		const deactivatedP1v2 = await repo.getById(p1v2._id);

		expect(rolledBackP1?.active).toBe(true);
		expect(deactivatedP1v2?.active).toBe(false);
	});
});

describe('SopOverridePouchRepository', () => {
	let db: PouchDB.Database;
	let repo: SopOverridePouchRepository;

	beforeEach(() => {
		db = new PouchDB(`test-sop-override-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		repo = createSopOverrideRepositoryForTest('SH001', db);
	});

	afterEach(async () => {
		if (db) await db.destroy();
	});

	it('should list only active overrides', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_override',
			'Winter Adjust',
			validRatios,
			overrideCtx
		);
		const { profile: p2, audit: a2 } = createInitialProfile(
			'sop_override',
			'Summer Adjust',
			{ ...validRatios, water_l_per_person_day: 20 },
			overrideCtx
		);

		await repo.createVersion(null, p1, a1);
		await repo.createVersion(null, p2, a2);

		const savedP2 = await repo.getById(p2._id);
		const {
			deactivatedPrev,
			profile: p2v2,
			audit: a3
		} = createNewVersion(savedP2!, { water_l_per_person_day: 25 }, 'Update to 25', overrideCtx);

		await repo.createVersion(deactivatedPrev, p2v2, a3);

		const active = await repo.listActive();
		expect(active).toHaveLength(2);
		expect(active.map((p) => p.name)).toContain('Winter Adjust');
		expect(active.map((p) => p.name)).toContain('Summer Adjust');
		expect(active.find((p) => p.name === 'Summer Adjust')?.version).toBe(2);
	});

	it('should set an override to active and deactivate all other overrides in the shelter database', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_override',
			'Winter Adjust',
			validRatios,
			overrideCtx
		);
		const { profile: p2, audit: a2 } = createInitialProfile(
			'sop_override',
			'Summer Adjust',
			{ ...validRatios, water_l_per_person_day: 20 },
			overrideCtx
		);

		await repo.createVersion(null, p1, a1);
		await repo.createVersion(null, p2, a2);

		// Activate p1
		await repo.setActive(p1._id, overrideCtx);

		// Now p1 must be active, p2 must be inactive
		let doc1 = await repo.getById(p1._id);
		let doc2 = await repo.getById(p2._id);
		expect(doc1?.active).toBe(true);
		expect(doc2?.active).toBe(false);

		// Activate p2
		await repo.setActive(p2._id, overrideCtx);

		// Now p2 must be active, p1 must be inactive
		doc1 = await repo.getById(p1._id);
		doc2 = await repo.getById(p2._id);
		expect(doc1?.active).toBe(false);
		expect(doc2?.active).toBe(true);
	});
});

describe('resolveEffective application helper', () => {
	let masterDb: PouchDB.Database;
	let overrideDb: PouchDB.Database;

	beforeEach(() => {
		masterDb = new PouchDB(`test-resolve-master-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		overrideDb = new PouchDB(`test-resolve-override-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
	});

	afterEach(async () => {
		if (masterDb) await masterDb.destroy();
		if (overrideDb) await overrideDb.destroy();
	});

	it('should resolve effective profile based on active override and master', async () => {
		const masterRepo = createSopMasterRepositoryForTest(masterDb);
		const overrideRepo = createSopOverrideRepositoryForTest('SH001', overrideDb);

		// 1. Initial state: neither has active profiles
		let effective = await resolveEffectiveRatios(overrideRepo, masterRepo);
		expect(effective).toBeNull();

		// 2. Add active master profile
		const { profile: masterProfile, audit: masterAudit } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			validRatios,
			masterCtx
		);
		await masterRepo.createVersion(null, masterProfile, masterAudit);

		effective = await resolveEffectiveRatios(overrideRepo, masterRepo);
		expect(effective).not.toBeNull();
		expect(effective?.ratio_source).toBe('master');
		expect(effective?.ratios.water_l_per_person_day).toBe(15);

		// 3. Add active override profile
		const { profile: overrideProfile, audit: overrideAudit } = createInitialProfile(
			'sop_override',
			'Local Override',
			{ ...validRatios, water_l_per_person_day: 20 },
			overrideCtx
		);
		await overrideRepo.createVersion(null, overrideProfile, overrideAudit);

		effective = await resolveEffectiveRatios(overrideRepo, masterRepo);
		expect(effective?.ratio_source).toBe('override');
		expect(effective?.ratios.water_l_per_person_day).toBe(20);
	});
});

describe('Repository Caching and Singletons', () => {
	it('should return master repository singleton', () => {
		clearSopMasterCache();

		const repo1 = sopMasterRepository();
		const repo2 = sopMasterRepository();
		expect(repo1).toBe(repo2);
	});

	it('should isolate overrides per shelter code and clear cache correctly', () => {
		clearSopOverrideCache();

		const repo1 = sopOverrideRepository('SH001');
		const repo2 = sopOverrideRepository('SH002');
		expect(repo1).not.toBe(repo2);

		const repo3 = sopOverrideRepository('SH001');
		expect(repo3).toBe(repo1); // Should retrieve from cache map

		clearSopOverrideCache('SH001');
		const repo4 = sopOverrideRepository('SH001');
		expect(repo4).not.toBe(repo1); // Cached SH001 repo was deleted

		expect(sopOverrideRepository('SH002')).toBe(repo2); // SH002 should still be cached

		clearSopOverrideCache();
		const repo5 = sopOverrideRepository('SH002');
		expect(repo5).not.toBe(repo2); // All caches cleared
	});
});
