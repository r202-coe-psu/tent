// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';
import {
	createInitialProfile,
	createNewVersion,
	type SopMaster,
	type SopOverride
} from '../domain/sop-ratio';
import {
	SopMasterPouchRepository,
	SopOverridePouchRepository,
	resolveEffectiveRatios
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

describe('SopMasterPouchRepository', () => {
	let db: PouchDB.Database;
	let repo: SopMasterPouchRepository;

	beforeEach(() => {
		db = new PouchDB(`test-sop-master-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		repo = new SopMasterPouchRepository(db);
	});

	it('should list only active master profiles', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			{ water_l_per_person_day: 15 },
			masterCtx
		);
		const { profile: p2, audit: a2 } = createInitialProfile(
			'sop_profile',
			'Thai Red Cross',
			{ water_l_per_person_day: 20 },
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
			{ water_l_per_person_day: 15 },
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
			{ water_l_per_person_day: 10 },
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
			{ water_l_per_person_day: 15 },
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
			{ water_l_per_person_day: 15 },
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
			{ water_l_per_person_day: 15 },
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
		repo = new SopOverridePouchRepository('SH001', db);
	});

	it('should list only active overrides', async () => {
		const { profile: p1, audit: a1 } = createInitialProfile(
			'sop_override',
			'Winter Adjust',
			{ water_l_per_person_day: 15 },
			overrideCtx
		);
		const { profile: p2, audit: a2 } = createInitialProfile(
			'sop_override',
			'Summer Adjust',
			{ water_l_per_person_day: 20 },
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
});

describe('resolveEffective application helper', () => {
	it('should resolve effective profile based on active override and master', async () => {
		const masterDb = new PouchDB(`test-resolve-master-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		const overrideDb = new PouchDB(`test-resolve-override-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});

		const masterRepo = new SopMasterPouchRepository(masterDb);
		const overrideRepo = new SopOverridePouchRepository('SH001', overrideDb);

		// 1. Initial state: neither has active profiles
		let effective = await resolveEffectiveRatios(overrideRepo, masterRepo);
		expect(effective).toBeNull();

		// 2. Add active master profile
		const { profile: masterProfile, audit: masterAudit } = createInitialProfile(
			'sop_profile',
			'Sphere Baseline',
			{ water_l_per_person_day: 15 },
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
			{ water_l_per_person_day: 20 },
			overrideCtx
		);
		await overrideRepo.createVersion(null, overrideProfile, overrideAudit);

		effective = await resolveEffectiveRatios(overrideRepo, masterRepo);
		expect(effective?.ratio_source).toBe('override');
		expect(effective?.ratios.water_l_per_person_day).toBe(20);
	});
});
