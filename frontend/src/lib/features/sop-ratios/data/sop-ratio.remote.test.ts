import { describe, expect, it, vi } from 'vitest';
import {
	createInitialProfile,
	createNewVersion,
	SOP_MASTER_ACTIVE_POINTER_ID
} from '../domain/sop-ratio';
import { validRatios } from '../domain/sop-ratio.fixture';
import { SopMasterRemoteRepository } from './sop-ratio.remote';

describe('SopMasterRemoteRepository version creation', () => {
	it('rebuilds a conflicting immutable version with the next number instead of overwriting it', async () => {
		const repository = new SopMasterRemoteRepository('catalog_test');
		const ctx = { createdBy: 'tester' };
		const { profile: v1 } = createInitialProfile(
			'sop_profile',
			'Concurrent Standard',
			validRatios,
			ctx
		);
		const { profile: v2 } = createNewVersion(v1, { water_l_per_person_day: '20' }, 'v2', ctx);
		const { profile: winningV3 } = createNewVersion(
			v2,
			{ water_l_per_person_day: '21' },
			'winning v3',
			ctx
		);

		vi.spyOn(repository, 'listVersions')
			.mockResolvedValueOnce([v2, v1])
			.mockResolvedValueOnce([winningV3, v2, v1]);
		const save = vi
			.spyOn(repository, 'createVersion')
			.mockRejectedValueOnce(new Error('409_CONFLICT'))
			.mockImplementationOnce(async (previous, profile, audit) => ({
				profile,
				deactivatedPrev: previous,
				audit
			}));

		const result = await repository.createNextVersion(
			v1,
			{ water_l_per_person_day: '25' },
			'edit after rollback',
			ctx
		);

		expect(save.mock.calls.map(([, profile]) => profile.version)).toEqual([3, 4]);
		expect(result.profile.version).toBe(4);
		expect(result.profile._id).toBe(`sop_profile:${v1.slug}:4`);
		expect(result.profile.ratios.water_l_per_person_day).toBe('25');
		expect(winningV3.ratios.water_l_per_person_day).toBe('21');
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
});
