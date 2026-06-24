import { describe, it, expect } from 'vitest';
import {
	createInitialProfile,
	createNewVersion,
	sopMasterSchema,
	sopOverrideSchema,
	resolveEffectiveProfile
} from './sop-ratio';
import type { AuthorContext } from '$lib/db/model';

describe('SOP Ratio Domain', () => {
	const masterCtx = { createdBy: 'admin' };
	const overrideCtx: AuthorContext & { base_profile_id: string } = {
		shelterCode: 'SH001',
		createdBy: 'admin',
		base_profile_id: 'sop_profile:base-id'
	};

	describe('createInitialProfile - Master', () => {
		it('should create a valid initial master profile with whitelist keys and audit trail', () => {
			const { profile, audit } = createInitialProfile(
				'sop_profile',
				'Sphere baseline',
				{ water_l_per_person_day: 15 },
				masterCtx
			);

			expect(profile.name).toBe('Sphere baseline');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(15);
			expect(profile.type).toBe('sop_profile');
			expect(profile._id.startsWith('sop_profile:')).toBe(true);
			expect((profile as any).shelter_code).toBeUndefined(); // Master has no shelter_code

			// Check audit trail
			expect(audit.action).toBe('created');
			expect(audit.target_type).toBe('sop_profile');

			// Schema should validate successfully
			expect(() => sopMasterSchema.parse(profile)).not.toThrow();
		});

		it('should filter non-whitelist keys and throw empty ratio error', () => {
			expect(() => {
				// @ts-expect-error Testing invalid runtime input
				createInitialProfile('sop_profile', 'Sphere baseline', { invalid_key: 10 }, masterCtx);
			}).toThrow('At least one ratio must be specified');
		});

		it('should reject negative or zero values', () => {
			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ water_l_per_person_day: 0 },
					masterCtx
				);
			}).toThrow();

			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ water_l_per_person_day: -5 },
					masterCtx
				);
			}).toThrow();
		});
	});

	describe('createInitialProfile - Override', () => {
		it('should create a valid initial override with base_profile_id, shelter_code and audit trail', () => {
			const { profile, audit } = createInitialProfile(
				'sop_override',
				'Winter Override',
				{ water_l_per_person_day: 18 },
				overrideCtx
			);

			expect(profile.name).toBe('Winter Override');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(18);
			expect(profile.type).toBe('sop_override');
			expect(profile.shelter_code).toBe('SH001');
			expect(profile.base_profile_id).toBe('sop_profile:base-id');
			expect(profile._id.startsWith('sop_override:')).toBe(true);

			// Check audit trail
			expect(audit.action).toBe('created');
			expect(audit.target_type).toBe('sop_override');

			// Schema should validate successfully
			expect(() => sopOverrideSchema.parse(profile)).not.toThrow();
		});
	});

	describe('createNewVersion - Master', () => {
		it('should create a new version of master, deactivate the previous one, and return audit', () => {
			const { profile: prev } = createInitialProfile(
				'sop_profile',
				'Sphere baseline',
				{ water_l_per_person_day: 15 },
				masterCtx
			);

			const {
				deactivatedPrev,
				profile: next,
				audit
			} = createNewVersion(
				prev,
				{ water_l_per_person_day: 20 },
				'Updated water ratio based on new standards',
				masterCtx
			);

			expect(deactivatedPrev?.active).toBe(false);
			expect(deactivatedPrev?._id).toBe(prev._id); // ID must be the same

			// Check new profile
			expect(next.name).toBe('Sphere baseline');
			expect(next.version).toBe(2);
			expect(next.ratios.water_l_per_person_day).toBe(20);
			expect(next._id).not.toBe(prev._id);
			expect(next.active).toBe(true);

			// Check audit
			expect(audit?.action).toBe('manual_adjust');
			expect(audit?.target_id).toBe(next._id);
			expect(audit?.reason).toBe('Updated water ratio based on new standards');
			expect(audit?.context?.previous_version).toBe(1);
		});

		it('should abort gracefully (Idempotent no-op) if changes yield identical state', () => {
			const { profile: prev } = createInitialProfile(
				'sop_profile',
				'Standard',
				{ water_l_per_person_day: 15 },
				masterCtx
			);

			const result = createNewVersion(prev, { water_l_per_person_day: 15 }, 'No change', masterCtx);

			expect(result.deactivatedPrev).toBeNull();
			expect(result.audit).toBeNull();
			expect(result.profile).toBe(prev);
		});
	});

	describe('createNewVersion - Override', () => {
		it('should create a new version of override, deactivate the previous one, and return audit', () => {
			const { profile: prev } = createInitialProfile(
				'sop_override',
				'Winter Override',
				{ water_l_per_person_day: 18 },
				overrideCtx
			);

			const {
				deactivatedPrev,
				profile: next,
				audit
			} = createNewVersion(
				prev,
				{ water_l_per_person_day: 22 },
				'Updated local water ratio',
				overrideCtx
			);

			expect(deactivatedPrev?.active).toBe(false);
			expect(deactivatedPrev?._id).toBe(prev._id);

			expect(next.name).toBe('Winter Override');
			expect(next.version).toBe(2);
			expect(next.ratios.water_l_per_person_day).toBe(22);
			expect(next.active).toBe(true);

			expect(audit?.action).toBe('manual_adjust');
			expect(audit?.target_type).toBe('sop_override');
			expect(audit?.target_id).toBe(next._id);
		});
	});

	describe('resolveEffectiveProfile', () => {
		it('should fall back to master if override is absent or inactive', () => {
			const { profile: master } = createInitialProfile(
				'sop_profile',
				'Master Baseline',
				{ water_l_per_person_day: 15 },
				masterCtx
			);

			const { profile: override } = createInitialProfile(
				'sop_override',
				'Local Override',
				{ water_l_per_person_day: 20 },
				overrideCtx
			);

			// 1. Both active -> override wins
			let resolved = resolveEffectiveProfile(override, master);
			expect(resolved?.ratio_source).toBe('override');
			expect(resolved?.ratios.water_l_per_person_day).toBe(20);

			// 2. Override inactive -> master wins
			const inactiveOverride = { ...override, active: false };
			resolved = resolveEffectiveProfile(inactiveOverride, master);
			expect(resolved?.ratio_source).toBe('master');
			expect(resolved?.ratios.water_l_per_person_day).toBe(15);

			// 3. Both inactive -> null
			const inactiveMaster = { ...master, active: false };
			resolved = resolveEffectiveProfile(inactiveOverride, inactiveMaster);
			expect(resolved).toBeNull();

			// 4. Override absent -> master wins
			resolved = resolveEffectiveProfile(null, master);
			expect(resolved?.ratio_source).toBe('master');
			expect(resolved?.ratios.water_l_per_person_day).toBe(15);
		});
	});
});
