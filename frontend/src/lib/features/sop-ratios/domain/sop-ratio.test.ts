import { describe, it, expect } from 'vitest';
import {
	createInitialMasterProfile,
	createNewMasterVersion,
	createInitialOverrideProfile,
	createNewOverrideVersion,
	resolveEffectiveProfile,
	sopMasterSchema,
	sopOverrideSchema
} from './sop-ratio';
import type { AuthorContext } from '$lib/db/model';

describe('SOP Ratio Domain', () => {
	const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'admin' };

	describe('Master Profile', () => {
		it('should create a valid master profile with whitelist keys and audit trail', () => {
			const { profile, audit } = createInitialMasterProfile(
				'Sphere baseline',
				{ water_l_per_person_day: 15 },
				'admin'
			);

			expect(profile.name).toBe('Sphere baseline');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(15);
			expect(profile.type).toBe('sop_profile');
			expect(profile.schema_v).toBe(2);
			expect((profile as any).shelter_code).toBeUndefined(); // Master has no shelter_code
			expect(profile._id.startsWith('sop_profile:')).toBe(true);

			expect(audit.action).toBe('created');
			expect(audit.target_type).toBe('sop_profile');
			expect(() => sopMasterSchema.parse(profile)).not.toThrow();
		});

		it('should create new master version', () => {
			const { profile: prev } = createInitialMasterProfile(
				'Standard',
				{ water_l_per_person_day: 15 },
				'admin'
			);
			const {
				deactivatedPrev,
				profile: next,
				audit
			} = createNewMasterVersion(prev, { water_l_per_person_day: 20 }, 'Update', 'admin');

			expect(deactivatedPrev?.active).toBe(false);
			expect(next.version).toBe(2);
			expect(next.ratios.water_l_per_person_day).toBe(20);
			expect(audit?.target_id).toBe(next._id);
		});
	});

	describe('Override Profile', () => {
		it('should create valid override profile', () => {
			const { profile, audit } = createInitialOverrideProfile(
				'Custom Override',
				'sop_profile:master1',
				{ water_l_per_person_day: 20 },
				ctx
			);

			expect(profile.name).toBe('Custom Override');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(20);
			expect(profile.type).toBe('sop_override');
			expect(profile.shelter_code).toBe('SH001');
			expect(profile.base_profile_id).toBe('sop_profile:master1');
			expect(() => sopOverrideSchema.parse(profile)).not.toThrow();
		});

		it('should create new override version', () => {
			const { profile: prev } = createInitialOverrideProfile(
				'Custom Override',
				'sop_profile:master1',
				{ water_l_per_person_day: 20 },
				ctx
			);
			const { deactivatedPrev, profile: next } = createNewOverrideVersion(
				prev,
				{ water_l_per_person_day: 25 },
				'Update',
				ctx
			);

			expect(deactivatedPrev?.active).toBe(false);
			expect(next.version).toBe(2);
			expect(next.ratios.water_l_per_person_day).toBe(25);
			expect(next.base_profile_id).toBe('sop_profile:master1');
		});
	});

	describe('resolveEffectiveProfile', () => {
		it('should resolve to override if present and active', () => {
			const { profile: master } = createInitialMasterProfile(
				'Master',
				{ water_l_per_person_day: 15, rice_g_per_person_meal: 150 },
				'admin'
			);
			const { profile: override } = createInitialOverrideProfile(
				'Override',
				master._id,
				{ water_l_per_person_day: 20, rice_g_per_person_meal: 200 },
				ctx
			);

			const effective = resolveEffectiveProfile(master, override);
			expect(effective.water_l_per_person_day).toBe(20);
		});

		it('should resolve to master if override is missing or inactive', () => {
			const { profile: master } = createInitialMasterProfile(
				'Master',
				{ water_l_per_person_day: 15 },
				'admin'
			);
			const { profile: override } = createInitialOverrideProfile(
				'Override',
				master._id,
				{ water_l_per_person_day: 20 },
				ctx
			);
			override.active = false;

			const effective1 = resolveEffectiveProfile(master, null);
			expect(effective1.water_l_per_person_day).toBe(15);

			const effective2 = resolveEffectiveProfile(master, override);
			expect(effective2.water_l_per_person_day).toBe(15);
		});
	});
});
