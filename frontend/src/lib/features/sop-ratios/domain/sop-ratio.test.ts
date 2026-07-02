import { describe, it, expect } from 'vitest';
import {
	createInitialProfile,
	createNewVersion,
	sopMasterSchema,
	sopOverrideSchema,
	resolveEffectiveProfile,
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	SOP_MASTER_SCHEMA_VERSION,
	SOP_OVERRIDE_SCHEMA_VERSION
} from './sop-ratio';
import type { AuthorContext } from '$lib/db/model';

describe('SOP Ratio Domain', () => {
	const masterCtx = { createdBy: 'admin' };
	const overrideCtx: AuthorContext & { base_profile_id: string } = {
		shelterCode: 'SH001',
		createdBy: 'admin',
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

	describe('createInitialProfile - Master', () => {
		it('should create a valid initial master profile with whitelist keys and audit trail', () => {
			const { profile, audit } = createInitialProfile(
				'sop_profile',
				'Sphere baseline',
				validRatios,
				masterCtx
			);

			expect(profile.name).toBe('Sphere baseline');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(15);
			expect(profile.ratios.people_per_volunteer).toBe(50);
			expect(profile.type).toBe('sop_profile');
			expect(profile.schema_v).toBe(SOP_MASTER_SCHEMA_VERSION);
			expect((profile as any).shelter_code).toBeUndefined(); // Master has no shelter_code
			expect(profile._id.startsWith('sop_profile:')).toBe(true);

			expect(audit.action).toBe('created');
			expect(audit.target_type).toBe('sop_profile');

			// Schema should validate successfully
			expect(() => sopMasterSchema.parse(profile)).not.toThrow();
		});

		// Master ratios use existential constraint (>=1 key), not total constraint —
		// per CR-006 §Doc shape + CR-018 invariant #2. Override is total (see below).
		it('should create master profile when ratios has only 1 key (partial, CR-006/CR-018 #2)', () => {
			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ water_l_per_person_day: 15 },
					masterCtx
				);
			}).not.toThrow();
		});

		it('should create master profile when ratios has multiple keys but not the full 20 (partial)', () => {
			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ water_l_per_person_day: 15, people_per_volunteer: 50 },
					masterCtx
				);
			}).not.toThrow();
		});

		it('should reject master profile when ratios is empty {} (CR-018 invariant #2)', () => {
			expect(() => {
				createInitialProfile('sop_profile', 'Sphere baseline', {}, masterCtx);
			}).toThrow(/ratios ต้องมีอย่างน้อย 1 key/);
		});

		it('should reject non-whitelist or deprecated keys (strict check) — full payload', () => {
			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ ...validRatios, invalid_key: 10 } as any,
					masterCtx
				);
			}).toThrow();

			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ ...validRatios, rice_g_per_person_meal: 200 } as any,
					masterCtx
				);
			}).toThrow();

			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ ...validRatios, caregiver_per_elderly: 2 } as any,
					masterCtx
				);
			}).toThrow();
		});

		it('should reject non-whitelist keys even on a partial payload (strict mode also applies to partialRatiosSchema)', () => {
			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ water_l_per_person_day: 15, fake_unauthorized_key: 999 } as any,
					masterCtx
				);
			}).toThrow();
		});

		it('should reject negative or zero values', () => {
			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ ...validRatios, water_l_per_person_day: 0 },
					masterCtx
				);
			}).toThrow();

			expect(() => {
				createInitialProfile(
					'sop_profile',
					'Sphere baseline',
					{ ...validRatios, water_l_per_person_day: -5 },
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
				validRatios,
				overrideCtx
			);

			expect(profile.name).toBe('Winter Override');
			expect(profile.version).toBe(1);
			expect(profile.active).toBe(true);
			expect(profile.ratios.water_l_per_person_day).toBe(15);
			expect(profile.type).toBe('sop_override');
			expect(profile.schema_v).toBe(SOP_OVERRIDE_SCHEMA_VERSION);
			expect(profile.shelter_code).toBe('SH001');
			expect(profile.base_profile_id).toBe('sop_profile:base-id');
			expect(profile._id.startsWith('sop_override:')).toBe(true);

			expect(audit.action).toBe('created');
			expect(audit.target_type).toBe('sop_override');
			expect(() => sopOverrideSchema.parse(profile)).not.toThrow();
		});

		// Regression guard: override must remain a total constraint (full canonical set required,
		// CR-006/CR-018 #1) — must NOT accidentally start accepting partial ratios like master does.
		it('should reject override when ratios is only partial (regression: override must stay full-set required)', () => {
			expect(() => {
				createInitialProfile(
					'sop_override',
					'Winter Override',
					{ water_l_per_person_day: 15 } as any,
					overrideCtx
				);
			}).toThrow();
		});
	});

	describe('createNewVersion - Master', () => {
		it('should create a new version of master, deactivate the previous one, and return audit', () => {
			const { profile: prev } = createInitialProfile(
				'sop_profile',
				'Sphere baseline',
				validRatios,
				masterCtx
			);
			const {
				deactivatedPrev,
				profile: next,
				audit
			} = createNewVersion(
				prev,
				{ water_l_per_person_day: 20 },
				'Updated water ratio',
				masterCtx
			);

			expect(deactivatedPrev?.active).toBe(false);
			expect(next.version).toBe(2);
			expect(next.ratios.water_l_per_person_day).toBe(20);
			expect(audit?.target_id).toBe(next._id);
		});
	});

	describe('Idempotency and Partial Updates', () => {
		it('should abort gracefully (Idempotent no-op) if changes yield identical state', () => {
			const { profile: prev } = createInitialProfile(
				'sop_profile',
				'Sphere baseline',
				validRatios,
				masterCtx
			);

			const {
				deactivatedPrev,
				profile: next,
				audit
			} = createNewVersion(
				prev,
				{ water_l_per_person_day: 15 },
				'No actual change',
				masterCtx
			);

			expect(deactivatedPrev).toBeNull();
			expect(audit).toBeNull();
			expect(next).toBe(prev);
		});

		it('should keep untouched ratio keys after partial update', () => {
			const { profile: prev } = createInitialProfile(
				'sop_override',
				'Custom Override',
				validRatios,
				overrideCtx
			);

			const { profile: next } = createNewVersion(
				prev,
				{ water_l_per_person_day: 25 },
				'Update water only',
				overrideCtx
			);

			// Untouched keys must survive the partial update
			expect(next.ratios.people_per_volunteer).toBe(50);
			// Changed key must reflect new value
			expect(next.ratios.water_l_per_person_day).toBe(25);
			// A new doc must be created
			expect(next._id).not.toBe(prev._id);
			expect(next.version).toBe(2);
		});
	});

	describe('createNewVersion - Override', () => {
		it('should create a new version of override, deactivate the previous one, and return audit', () => {
			const { profile: prev } = createInitialProfile(
				'sop_override',
				'Winter Override',
				validRatios,
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
			expect(next.version).toBe(2);
			expect(next.ratios.water_l_per_person_day).toBe(22);
			expect(next.active).toBe(true);
			expect(audit?.action).toBe('manual_adjust');
			expect(audit?.target_id).toBe(next._id);
		});
	});

	describe('resolveEffectiveProfile', () => {
		it('should fall back to master if override is absent or inactive', () => {
			const { profile: master } = createInitialProfile(
				'sop_profile',
				'Master Baseline',
				validRatios,
				masterCtx
			);

			const { profile: override } = createInitialProfile(
				'sop_override',
				'Local Override',
				{ ...validRatios, water_l_per_person_day: 20 },
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

	describe('Calculation Kinds', () => {
		it('should have all 20 whitelist keys mapped to their exact calculation kind', () => {
			expect(SOP_RATIO_KEYS.length).toBe(20);
			for (const key of SOP_RATIO_KEYS) {
				expect(SOP_RATIO_KIND[key]).toBeDefined();
				expect(['multiply', 'divide', 'threshold'].includes(SOP_RATIO_KIND[key])).toBe(true);
			}
			expect(SOP_RATIO_KIND.people_per_volunteer).toBe('divide');
			expect(SOP_RATIO_KIND.water_l_per_person_day).toBe('multiply');
			expect(SOP_RATIO_KIND.max_queue_minutes).toBe('threshold');
		});
	});
});
