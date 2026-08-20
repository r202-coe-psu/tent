import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictError } from '$lib/utils/errors';
import {
	createInitialProfile,
	SOP_MASTER_ACTIVE_POINTER_ID,
	type SopMaster
} from '../domain/sop-ratio';
import { validRatios } from '../domain/sop-ratio.fixture';
import { SopMasterRemoteRepository } from './sop-ratio.remote';

describe('SopMasterRemoteRepository version creation', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	it('creates a new version and promotes pointer successfully when no conflict occurs', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		const ctx = { createdBy: 'tester' };
		const { profile: v1 } = createInitialProfile('sop_profile', 'Standard SOP', validRatios, ctx);
		const v1WithSlug = { ...v1, slug: 'standard-sop' };

		vi.spyOn(repository, 'listVersions').mockResolvedValue([v1WithSlug]);
		vi.spyOn(repository, 'getActivePointer').mockResolvedValue({
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			_rev: '1-old',
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: v1WithSlug._id,
			active_slug: 'standard-sop',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'tester'
		});

		const couchDb = await import('$lib/db/couch-db');
		const saveBulkSpy = vi
			.spyOn(couchDb, 'saveBulkAtomic')
			.mockImplementation(
				async (_db, docs) => docs as unknown as ReturnType<typeof couchDb.saveBulkAtomic>
			);
		const putDocSpy = vi
			.spyOn(couchDb, 'putDoc')
			.mockImplementation(
				async (_db, doc) =>
					({ ...doc, _rev: '2-new' }) as unknown as ReturnType<typeof couchDb.putDoc>
			);
		vi.spyOn(couchDb, 'getDocWithConflicts').mockResolvedValue({
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:standard-sop:2',
			active_slug: 'standard-sop',
			active_version: 2,
			updated_at: new Date().toISOString(),
			updated_by: 'tester'
		} as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>);
		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:standard-sop:2') {
				return {
					...v1WithSlug,
					_id: 'sop_profile:standard-sop:2',
					version: 2,
					active: false
				};
			}
			return null;
		});

		const result = await repository.createNextVersion(
			v1WithSlug,
			{ water_l_per_person_day: '25' },
			'Update water ratio',
			ctx
		);

		expect(saveBulkSpy).toHaveBeenCalledTimes(1);
		expect(putDocSpy).toHaveBeenCalledTimes(1);
		expect(putDocSpy).toHaveBeenCalledWith(
			'catalog_test',
			expect.objectContaining({
				_id: SOP_MASTER_ACTIVE_POINTER_ID,
				_rev: '1-old'
			}),
			undefined,
			{ onConflict: 'throw' }
		);
		expect(result.profile.version).toBe(2);
		expect(result.profile.active).toBe(true);
	});

	it('one immutable version + one pointer CAS: when pointer CAS conflicts, version is persisted once as draft and ConflictError is thrown without auto-retrying N+1', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		const ctx = { createdBy: 'tester' };
		const { profile: v1 } = createInitialProfile('sop_profile', 'Standard SOP', validRatios, ctx);
		const v1WithSlug = { ...v1, slug: 'standard-sop' };

		vi.spyOn(repository, 'listVersions').mockResolvedValue([v1WithSlug]);
		const refetchSpy = vi.spyOn(repository, 'getActivePointer').mockResolvedValue({
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			_rev: '1-old',
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: v1WithSlug._id,
			active_slug: 'standard-sop',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'tester'
		});

		const couchDb = await import('$lib/db/couch-db');
		const saveBulkSpy = vi
			.spyOn(couchDb, 'saveBulkAtomic')
			.mockImplementation(
				async (_db, docs) => docs as unknown as ReturnType<typeof couchDb.saveBulkAtomic>
			);
		vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc, _init, options) => {
			if (doc._id === SOP_MASTER_ACTIVE_POINTER_ID && options?.onConflict === 'throw') {
				throw new ConflictError('Document update conflict');
			}
			return { ...doc, _rev: '1-saved' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		await expect(
			repository.createNextVersion(
				v1WithSlug,
				{ water_l_per_person_day: '30' },
				'Conflict Edit',
				ctx
			)
		).rejects.toThrow(
			'SOP master version 2 was saved as draft, but could not be promoted to active master'
		);

		// 1. Version 2 + audit were persisted exactly ONCE (saveBulkAtomic called once)
		expect(saveBulkSpy).toHaveBeenCalledTimes(1);
		const savedDocs = saveBulkSpy.mock.calls[0][1];
		expect((savedDocs as Array<{ version?: number }>).some((d) => d.version === 2)).toBe(true);

		// 2. Active pointer refetch was called to sync state
		expect(refetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe('SopMasterRemoteRepository Active Pointer & Migration Invariants', () => {
	it('legacy migration: fails loudly with actionable error when multiple active master profiles exist without pointer', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		const { profile: p1 } = createInitialProfile('sop_profile', 'Profile One', validRatios, {
			createdBy: 't'
		});
		const { profile: p2 } = createInitialProfile('sop_profile', 'Profile Two', validRatios, {
			createdBy: 't'
		});
		p1.active = true;
		p2.active = true;

		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);
		// @ts-expect-error accessing private repo for mock
		vi.spyOn(repository.repo, 'allByType').mockResolvedValue([p1, p2]);

		await expect(repository.listActive()).rejects.toThrow(
			'Multiple active master profiles found without active pointer; manual repair required'
		);
	});

	it('legacy migration: auto-bootstraps pointer when exactly one active legacy master exists', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		const { profile: p1 } = createInitialProfile(
			'sop_profile',
			'Single Legacy Active',
			validRatios,
			{ createdBy: 't' }
		);
		p1.active = true;

		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);
		// @ts-expect-error accessing private repo for mock
		vi.spyOn(repository.repo, 'allByType').mockResolvedValue([p1]);

		const active = await repository.listActive();
		expect(active.length).toBe(1);
		expect(active[0]._id).toBe(p1._id);
	});

	it('resolves active master strictly through the pointer document', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		const { profile: p1 } = createInitialProfile('sop_profile', 'Baseline', validRatios, {
			createdBy: 't'
		});
		p1._id = 'sop_profile:baseline:1';
		p1.active = false; // Projection may be false

		const pointerDoc = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active' as const,
			schema_v: 1 as const,
			active_profile_id: 'sop_profile:baseline:1',
			active_slug: 'baseline',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'tester'
		};

		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(pointerDoc);
		vi.spyOn(repository, 'getById').mockResolvedValue({ ...p1, active: true });

		const active = await repository.listActive();
		expect(active.length).toBe(1);
		expect(active[0]._id).toBe('sop_profile:baseline:1');
		expect(active[0].active).toBe(true);
	});

	it('createInitial: pointer creation conflict throws ConflictError and does not report profile active', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		vi.spyOn(repository, 'getBySlug').mockResolvedValue(null);
		const refetchSpy = vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);

		// We import putDoc mock/spy or test against couchDb throwing ConflictError
		const couchDb = await import('$lib/db/couch-db');
		vi.spyOn(couchDb, 'putDoc').mockImplementation(async (db, doc, init, options) => {
			if (doc._id === SOP_MASTER_ACTIVE_POINTER_ID && options?.onConflict === 'throw') {
				const { ConflictError } = await import('$lib/utils/errors');
				throw new ConflictError('Document update conflict');
			}
			return { ...doc, _rev: '1-test' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		const { ConflictError } = await import('$lib/utils/errors');
		await expect(
			repository.createInitial('Conflicting First Profile', validRatios, 'tester')
		).rejects.toBeInstanceOf(ConflictError);

		// Refetch was invoked to synchronize latest pointer state
		expect(refetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe('getVerifiedActiveMaster and getVerifiedActiveSopProfile (CR-081)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns verified master when active pointer and target profile exist and match 100%', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const validProfile = {
			_id: 'sop_profile:sphere-baseline:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Sphere Baseline',
			slug: 'sphere-baseline',
			ratios: validRatios,
			version: 1,
			active: false
		};
		const validPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:sphere-baseline:1',
			active_slug: 'sphere-baseline',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'admin'
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return validPointer as unknown as ReturnType<typeof couchDb.getDocWithConflicts>;
			return null;
		});
		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:sphere-baseline:1')
				return validProfile as unknown as ReturnType<typeof couchDb.getDoc>;
			return null;
		});

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const result = await getVerifiedActiveMaster('catalog_test');

		expect(result._id).toBe('sop_profile:sphere-baseline:1');
		expect(result.active).toBe(true);
	});

	it('throws SopMasterIntegrityError (pointer_missing) when singleton pointer is missing', async () => {
		const couchDb = await import('$lib/db/couch-db');
		vi.spyOn(couchDb, 'getDocWithConflicts').mockResolvedValue(null);

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');

		await expect(getVerifiedActiveMaster('catalog_test')).rejects.toSatisfy(
			(err: unknown) => err instanceof SopMasterIntegrityError && err.issue === 'pointer_missing'
		);
	});

	it('throws SopMasterIntegrityError (pointer_conflicted) immediately without fetching profile when pointer has _conflicts', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const conflictedPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:sphere-baseline:1',
			active_slug: 'sphere-baseline',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'admin',
			_conflicts: ['2-conflicting-leaf-revision']
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockResolvedValue(
			conflictedPointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>
		);
		const getDocSpy = vi.spyOn(couchDb, 'getDoc');

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');

		await expect(getVerifiedActiveMaster('catalog_test')).rejects.toSatisfy(
			(err: unknown) => err instanceof SopMasterIntegrityError && err.issue === 'pointer_conflicted'
		);

		// Assert target profile retrieval (getDoc) was NOT called after conflict detection
		expect(getDocSpy).not.toHaveBeenCalled();
	});

	it('throws SopMasterIntegrityError (pointer_malformed) when pointer shape is invalid', async () => {
		const couchDb = await import('$lib/db/couch-db');
		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return { _id: SOP_MASTER_ACTIVE_POINTER_ID, type: 'invalid' } as unknown as ReturnType<
					typeof couchDb.getDocWithConflicts
				>;
			return null;
		});

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');

		await expect(getVerifiedActiveMaster('catalog_test')).rejects.toSatisfy(
			(err: unknown) => err instanceof SopMasterIntegrityError && err.issue === 'pointer_malformed'
		);
	});

	it('throws SopMasterIntegrityError (profile_missing) when target profile does not exist', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const pointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:missing:1',
			active_slug: 'missing',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'admin'
		};
		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return pointer as unknown as ReturnType<typeof couchDb.getDocWithConflicts>;
			return null;
		});
		vi.spyOn(couchDb, 'getDoc').mockResolvedValue(null);

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');

		await expect(getVerifiedActiveMaster('catalog_test')).rejects.toSatisfy(
			(err: unknown) => err instanceof SopMasterIntegrityError && err.issue === 'profile_missing'
		);
	});

	it('throws SopMasterIntegrityError (pointer_target_mismatch) on slug or version mismatch', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const profile = {
			_id: 'sop_profile:sphere-baseline:2',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Sphere Baseline',
			slug: 'sphere-baseline',
			ratios: validRatios,
			version: 2,
			active: false
		};
		const mismatchedPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:sphere-baseline:2',
			active_slug: 'sphere-baseline',
			active_version: 1, // Mismatch! Target profile version is 2
			updated_at: new Date().toISOString(),
			updated_by: 'admin'
		};
		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return mismatchedPointer as unknown as ReturnType<typeof couchDb.getDocWithConflicts>;
			return null;
		});
		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:sphere-baseline:2')
				return profile as unknown as ReturnType<typeof couchDb.getDoc>;
			return null;
		});

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');

		await expect(getVerifiedActiveMaster('catalog_test')).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SopMasterIntegrityError && err.issue === 'pointer_target_mismatch'
		);
	});

	it('throws SopMasterIntegrityError (profile_malformed) when target profile shape is invalid', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const pointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:malformed:1',
			active_slug: 'malformed',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'admin'
		};
		const validProfile = {
			_id: 'sop_profile:malformed:1',
			type: 'sop_profile' as const,
			schema_v: 3 as const,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Malformed Profile',
			slug: 'malformed',
			ratios: validRatios,
			version: 1,
			active: false
		};
		const { ratios: _ratios, ...malformedProfile } = validProfile;

		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return pointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>;
			return null;
		});
		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:malformed:1')
				return malformedProfile as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>;
			return null;
		});

		const { getVerifiedActiveMaster } = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');

		await expect(getVerifiedActiveMaster('catalog_test')).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SopMasterIntegrityError &&
				err.issue === 'profile_malformed' &&
				err.message.includes('sop_profile:malformed:1')
		);
	});

	it('active override wins in getVerifiedActiveSopProfile without requiring master pointer', async () => {
		const couchDb = await import('$lib/db/couch-db');

		// Return null for catalog active pointer to simulate missing pointer
		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async () => null);

		const activeOverride = {
			_id: 'sop_override:SH001:1',
			type: 'sop_override' as const,
			schema_v: 2 as const,
			shelter_code: 'SH001',
			base_profile_id: 'sop_profile:base:1',
			name: 'Emergency High Density Override',
			ratios: validRatios,
			version: 1,
			active: true,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'manager'
		};

		// Mock listActive for sopOverrideRepository
		const repoModule = await import('./sop-ratio.remote');
		const overrideRepo = repoModule.sopOverrideRepository('SH001');
		vi.spyOn(overrideRepo, 'listActive').mockResolvedValue([activeOverride]);

		const { getVerifiedActiveSopProfile } = await import('../application/queries');
		const effective = await getVerifiedActiveSopProfile('SH001');

		expect(effective._id).toBe('sop_override:SH001:1');
		expect(effective.type).toBe('sop_override');
	});
});

describe('Shared Post-Write Verification (Blocker 2 of CR-081)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('createNextVersion happy path: post-write verification succeeds and returns active: true', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		const baseProfile: SopMaster = {
			_id: 'sop_profile:sphere-baseline:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Sphere Baseline',
			slug: 'sphere-baseline',
			ratios: validRatios,
			version: 1,
			active: true
		};

		vi.spyOn(repository, 'listVersions').mockResolvedValue([baseProfile]);

		const v2Profile: SopMaster = {
			...baseProfile,
			_id: 'sop_profile:sphere-baseline:2',
			version: 2,
			active: false
		};

		vi.spyOn(couchDb, 'saveBulkAtomic').mockImplementation(async (_db, docs) => {
			return docs as unknown as ReturnType<typeof couchDb.saveBulkAtomic>;
		});

		const putDocSpy = vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc) => {
			return { ...doc, _rev: '1-pointer' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		const v2Pointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:sphere-baseline:2',
			active_slug: 'sphere-baseline',
			active_version: 2,
			updated_at: new Date().toISOString(),
			updated_by: 'tester'
		};

		const getDocWithConflictsSpy = vi
			.spyOn(couchDb, 'getDocWithConflicts')
			.mockImplementation(async (_db, id) => {
				if (id === SOP_MASTER_ACTIVE_POINTER_ID)
					return v2Pointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>;
				return null;
			});

		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:sphere-baseline:2')
				return v2Profile as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>;
			return null;
		});

		const result = await repository.createNextVersion(
			baseProfile,
			{ water_l_per_person_day: '25' },
			'Increase water',
			{ createdBy: 'tester' }
		);

		expect(result.profile.active).toBe(true);
		expect(result.profile._id).toBe('sop_profile:sphere-baseline:2');
		expect(putDocSpy).toHaveBeenCalled();
		expect(getDocWithConflictsSpy).toHaveBeenCalled();
	});

	it('createNextVersion post-write mismatch: throws ConflictError when post-write verification targets another profile', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const { ConflictError } = await import('$lib/utils/errors');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		const baseProfile: SopMaster = {
			_id: 'sop_profile:sphere-baseline:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Sphere Baseline',
			slug: 'sphere-baseline',
			ratios: validRatios,
			version: 1,
			active: true
		};

		const otherProfile: SopMaster = {
			_id: 'sop_profile:other-profile:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Other Profile',
			slug: 'other-profile',
			ratios: validRatios,
			version: 1,
			active: true
		};

		vi.spyOn(repository, 'listVersions').mockResolvedValue([baseProfile]);

		const saveBulkSpy = vi
			.spyOn(couchDb, 'saveBulkAtomic')
			.mockImplementation(async (_db, docs) => {
				return docs as unknown as ReturnType<typeof couchDb.saveBulkAtomic>;
			});

		const putDocSpy = vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc) => {
			return { ...doc, _rev: '1-pointer' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		const otherPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:other-profile:1',
			active_slug: 'other-profile',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'other'
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return otherPointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>;
			return null;
		});

		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:other-profile:1')
				return otherProfile as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>;
			return null;
		});

		await expect(
			repository.createNextVersion(
				baseProfile,
				{ water_l_per_person_day: '25' },
				'Increase water',
				{ createdBy: 'tester' }
			)
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof ConflictError &&
				err.message.includes(
					'was saved as a draft, but post-write verification found active pointer targets another profile'
				)
		);

		// Verified draft was saved once
		expect(saveBulkSpy).toHaveBeenCalledTimes(1);
		// Pointer put was attempted once
		expect(putDocSpy).toHaveBeenCalledTimes(1);
	});

	it('setActive post-write mismatch: throws ConflictError and skips audit write when pointer targets another profile', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const { ConflictError } = await import('$lib/utils/errors');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		const targetProfile: SopMaster = {
			_id: 'sop_profile:target:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Target Profile',
			slug: 'target',
			ratios: validRatios,
			version: 1,
			active: false
		};

		const competitorProfile: SopMaster = {
			_id: 'sop_profile:competitor:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Competitor Profile',
			slug: 'competitor',
			ratios: validRatios,
			version: 1,
			active: true
		};

		vi.spyOn(repository, 'getById').mockResolvedValue(targetProfile);

		const putDocSpy = vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc) => {
			return { ...doc, _rev: '1-pointer' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		const competitorPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:competitor:1',
			active_slug: 'competitor',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'competitor'
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return competitorPointer as unknown as Awaited<
					ReturnType<typeof couchDb.getDocWithConflicts>
				>;
			return null;
		});

		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:competitor:1')
				return competitorProfile as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>;
			return null;
		});

		await expect(
			repository.setActive('sop_profile:target:1', { createdBy: 'tester' })
		).rejects.toBeInstanceOf(ConflictError);

		// Verify putDoc was called only once (for pointer update) and NOT a second time for audit write
		expect(putDocSpy).toHaveBeenCalledTimes(1);
	});

	it('verifyActiveMasterPromotion propagates SopMasterIntegrityError without converting to ConflictError', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		const targetProfile: SopMaster = {
			_id: 'sop_profile:target:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Target Profile',
			slug: 'target',
			ratios: validRatios,
			version: 1,
			active: false
		};

		vi.spyOn(repository, 'getById').mockResolvedValue(targetProfile);
		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);
		vi.spyOn(couchDb, 'putDoc').mockResolvedValue({
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			_rev: '1-a'
		} as unknown as Awaited<ReturnType<typeof couchDb.putDoc>>);

		// Mock getDocWithConflicts to return pointer with CouchDB conflicts
		const conflictedPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:target:1',
			active_slug: 'target',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'admin',
			_conflicts: ['2-conflicting-leaf-revision']
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockResolvedValue(
			conflictedPointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>
		);

		await expect(repository.setActive('sop_profile:target:1')).rejects.toSatisfy(
			(err: unknown) => err instanceof SopMasterIntegrityError && err.issue === 'pointer_conflicted'
		);
	});

	it('createInitial happy path: post-write verification succeeds and returns active: true', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		vi.spyOn(repository, 'getBySlug').mockResolvedValue(null);
		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);

		let capturedDraft: SopMaster | null = null;
		let capturedPointer: {
			active_profile_id: string;
			active_slug: string;
			active_version: number;
		} | null = null;

		vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc) => {
			const docObj = doc as unknown as {
				_id: string;
				type: string;
				active_profile_id?: string;
				active_slug?: string;
				active_version?: number;
			};
			if (docObj.type === 'sop_profile') {
				capturedDraft = docObj as unknown as SopMaster;
			} else if (docObj._id === SOP_MASTER_ACTIVE_POINTER_ID) {
				capturedPointer = docObj as {
					active_profile_id: string;
					active_slug: string;
					active_version: number;
				};
			}
			return { ...docObj, _rev: '1-a' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID && capturedPointer) {
				return {
					_id: SOP_MASTER_ACTIVE_POINTER_ID,
					type: 'sop_profile_active',
					schema_v: 1,
					active_profile_id: capturedPointer.active_profile_id,
					active_slug: capturedPointer.active_slug,
					active_version: capturedPointer.active_version,
					updated_at: new Date().toISOString(),
					updated_by: 'tester'
				} as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>;
			}
			return null;
		});

		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (capturedDraft && id === (capturedDraft as SopMaster)._id) {
				return capturedDraft as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>;
			}
			return null;
		});

		const result = await repository.createInitial('Brand New Profile', validRatios, 'tester');

		expect(result.profile.active).toBe(true);
		expect(result.profile.name).toBe('Brand New Profile');
	});

	it('createInitial post-write mismatch: throws ConflictError when post-write verification targets another profile', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const { ConflictError } = await import('$lib/utils/errors');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		vi.spyOn(repository, 'getBySlug').mockResolvedValue(null);
		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);

		const otherProfile: SopMaster = {
			_id: 'sop_profile:other:1',
			type: 'sop_profile',
			schema_v: 3,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'admin',
			name: 'Other Profile',
			slug: 'other',
			ratios: validRatios,
			version: 1,
			active: true
		};

		const putDocSpy = vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc) => {
			return { ...doc, _rev: '1-a' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		const otherPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:other:1',
			active_slug: 'other',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'other'
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockImplementation(async (_db, id) => {
			if (id === SOP_MASTER_ACTIVE_POINTER_ID)
				return otherPointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>;
			return null;
		});

		vi.spyOn(couchDb, 'getDoc').mockImplementation(async (_db, id) => {
			if (id === 'sop_profile:other:1')
				return otherProfile as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>;
			return null;
		});

		await expect(
			repository.createInitial('Brand New Mismatched', validRatios, 'tester')
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof ConflictError &&
				err.message.includes(
					'was saved as a draft, but post-write verification found active pointer targets another profile'
				)
		);

		// Put for pointer occurred once (no retries)
		expect(putDocSpy).toHaveBeenCalled();
	});

	it('createInitial integrity propagation: propagates SopMasterIntegrityError without converting to ConflictError', async () => {
		const couchDb = await import('$lib/db/couch-db');
		const repoModule = await import('./sop-ratio.remote');
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');
		const repository = new repoModule.SopMasterRemoteRepository('catalog_test');

		vi.spyOn(repository, 'getBySlug').mockResolvedValue(null);
		vi.spyOn(repository, 'getActivePointer').mockResolvedValue(null);

		vi.spyOn(couchDb, 'putDoc').mockImplementation(async (_db, doc) => {
			return { ...doc, _rev: '1-a' } as unknown as ReturnType<typeof couchDb.putDoc>;
		});

		const conflictedPointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: 'sop_profile:any:1',
			active_slug: 'any',
			active_version: 1,
			updated_at: new Date().toISOString(),
			updated_by: 'admin',
			_conflicts: ['2-conflicting-leaf-revision']
		};

		vi.spyOn(couchDb, 'getDocWithConflicts').mockResolvedValue(
			conflictedPointer as unknown as Awaited<ReturnType<typeof couchDb.getDocWithConflicts>>
		);

		await expect(
			repository.createInitial('Conflicted Initial', validRatios, 'tester')
		).rejects.toSatisfy(
			(err: unknown) => err instanceof SopMasterIntegrityError && err.issue === 'pointer_conflicted'
		);
	});
});
