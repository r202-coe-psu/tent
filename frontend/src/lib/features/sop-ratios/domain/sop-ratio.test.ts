import { describe, it, expect } from 'vitest';
import { createInitialProfile, createNewVersion, sopRatioProfileSchema } from './sop-ratio';
import type { AuthorContext } from '$lib/db/model';

describe('SOP Ratio Domain', () => {
	const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'admin' };

	describe('createInitialProfile', () => {
		it('should create a valid initial profile with whitelist keys and audit trail', () => {
			const { profile, audit } = createInitialProfile(
				'Sphere baseline',
				{ water_l_per_person_day: 15 },
				ctx
			);

			expect(profile.name).toBe('Sphere baseline');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(15);
			expect(profile.type).toBe('sop_profile');
			expect(profile._id.startsWith('sop_profile:')).toBe(true);

			// Check audit trail
			expect(audit.action).toBe('created');
			expect(audit.target_type).toBe('sop_profile');

			// Schema should validate successfully
			expect(() => sopRatioProfileSchema.parse(profile)).not.toThrow();
		});

		it('should filter non-whitelist keys and throw empty ratio error', () => {
			expect(() => {
				// @ts-expect-error Testing invalid runtime input
				createInitialProfile('Sphere baseline', { invalid_key: 10 }, ctx);
			}).toThrow('At least one ratio must be specified');
		});

		it('should reject negative or zero values', () => {
			expect(() => {
				createInitialProfile('Sphere baseline', { water_l_per_person_day: 0 }, ctx);
			}).toThrow();

			expect(() => {
				createInitialProfile('Sphere baseline', { water_l_per_person_day: -5 }, ctx);
			}).toThrow();
		});
	});

	describe('createNewVersion', () => {
		it('should create a new version, deactivate the previous one, and return audit', () => {
			const { profile: prev } = createInitialProfile(
				'Sphere baseline',
				{ water_l_per_person_day: 15 },
				ctx
			);

			const {
				deactivatedPrev,
				profile: next,
				audit
			} = createNewVersion(
				prev,
				{ water_l_per_person_day: 20 },
				'Updated water ratio based on new standards',
				ctx
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
				'Standard',
				{ water_l_per_person_day: 15 },
				ctx
			);

			const result = createNewVersion(prev, { water_l_per_person_day: 15 }, 'No change', ctx);

			expect(result.deactivatedPrev).toBeNull();
			expect(result.audit).toBeNull();
			expect(result.profile).toBe(prev);
		});

		it('should merge old ratios with new changes safely', () => {
			const { profile: prev } = createInitialProfile(
				'Standard',
				{ water_l_per_person_day: 15, rice_g_per_person_meal: 150 },
				ctx
			);

			const { profile: next } = createNewVersion(
				prev,
				{ rice_g_per_person_meal: 200 },
				'Update',
				ctx
			);

			// Water ratio remains unchanged, rice ratio is updated
			expect(next.ratios.water_l_per_person_day).toBe(15);
			expect(next.ratios.rice_g_per_person_meal).toBe(200);
		});
	});
});
