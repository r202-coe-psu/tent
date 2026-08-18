import { describe, expect, it, vi } from 'vitest';
import { createInitialProfile, createNewVersion } from '../domain/sop-ratio';
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
