// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import { useCreateMasterVersion, useCreateOverrideVersion } from './use-create-version';
import { useMasterVersionHistory, useOverrideVersionHistory } from './use-version-history';
import { sopRatioKeys, sopVersionKeys } from './queries';
import { SHELTER_CODE } from '$lib/db/shelter';
import { SOP_MASTER_SCHEMA_VERSION, SOP_OVERRIDE_SCHEMA_VERSION, type SopMaster, type SopOverride } from '../domain/sop-ratio';

// Mock svelte-sonner to prevent error output in tests
vi.mock('svelte-sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn()
	}
}));

// Mock repositories from data layer
const mockCreateVersion = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../data/sop-ratio.pouch', () => ({
	sopMasterRepository: () => ({
		createVersion: mockCreateVersion
	}),
	sopOverrideRepository: () => ({
		createVersion: mockCreateVersion
	})
}));

// Mock svelte-query client and hook creation
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (fn: () => unknown) => fn(),
	useQueryClient: () => ({
		invalidateQueries: mockInvalidateQueries
	}),
	createMutation: (fn: () => Record<string, unknown>) => {
		const options = fn();
		return {
			mutate: async (variables: unknown) => {
				const mutationFn = options.mutationFn as (v: unknown) => Promise<unknown>;
				const onSuccess = options.onSuccess as ((d: unknown, v: unknown) => void) | undefined;
				const onError = options.onError as ((e: unknown, v: unknown) => void) | undefined;
				try {
					const data = await mutationFn(variables);
					if (onSuccess) {
						onSuccess(data, variables);
					}
					return data;
				} catch (err) {
					if (onError) {
						onError(err, variables);
					}
					throw err;
				}
			}
		};
	}
}));

describe('SOP Ratios Application Hooks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const mockRatios = {
		water_l_per_person_day: 15,
		drinking_water_l_per_person_day: 3,
		cooking_water_l_per_person_day: 6,
		hygiene_water_l_per_person_day: 6,
		kcal_per_adult_day: 2000,
		people_per_tap: 80,
		people_per_handpump: 500,
		people_per_open_well: 400,
		people_per_laundry: 50,
		people_per_bathing: 100,
		people_per_toilet_female: 20,
		people_per_toilet_male: 20,
		people_per_dining_point_adult: 100,
		people_per_dining_point_child: 50,
		m2_per_person_living: 3.5,
		m2_per_person_living_cold: 4.5,
		m2_per_person_total: 45,
		max_waterpoint_distance_m: 500,
		max_queue_minutes: 30,
		people_per_volunteer: 50
	};

	describe('useCreateOverrideVersion', () => {
		const validOverrideInput = {
			prev: {
				_id: 'sop_override:SH001:baseline',
				_rev: '1-abc',
				name: 'Sphere baseline',
				version: 1,
				active: true,
				/* Intentional schema_v bump (Master v3 / Override v2) explicitly overrides CR-021 wording 
				   to enforce strict compliance with CR-006 structural amendments (2026-06-25), 
				   preventing silent un-marshaling failures in PouchDB. */
				type: 'sop_override' as const,
				schema_v: SOP_OVERRIDE_SCHEMA_VERSION as SopOverride['schema_v'],
				shelter_code: SHELTER_CODE,
				base_profile_id: 'sop_profile:baseline',
				created_at: '2026-07-03T00:00:00.000Z',
				updated_at: '2026-07-03T00:00:00.000Z',
				created_by: 'tester',
				ratios: mockRatios
			},
			changes: {
				water_l_per_person_day: 20
			},
			reason: 'Test change',
			ctx: {
				shelterCode: SHELTER_CODE,
				createdBy: 'tester'
			}
		};

		it('should succeed and invalidate query cache when shelterCode matches SHELTER_CODE', async () => {
			const mutation = useCreateOverrideVersion();
			await mutation.mutate(validOverrideInput);

			// Verify data layer was called
			expect(mockCreateVersion).toHaveBeenCalled();

			// Verify query cache was invalidated
			expect(mockInvalidateQueries).toHaveBeenCalledWith({
				queryKey: sopRatioKeys.all
			});

			// Verify toast notification succeeded
			expect(toast.success).toHaveBeenCalledWith('บันทึกเวอร์ชัน Override SOP สำเร็จ');
		});

		it('should block execution and throw error when shelterCode does not match SHELTER_CODE', async () => {
			const mutation = useCreateOverrideVersion();
			const invalidInput = {
				...validOverrideInput,
				ctx: {
					shelterCode: 'SH999', // Mismatched shelter code
					createdBy: 'tester'
				}
			};

			await expect(mutation.mutate(invalidInput)).rejects.toThrow(
				`shelterCode mismatch: expected ${SHELTER_CODE}, got SH999`
			);

			// Verify data layer was NOT called due to the guard block
			expect(mockCreateVersion).not.toHaveBeenCalled();

			// Verify toast notification failed or was called with error (via onError)
			expect(toast.error).toHaveBeenCalledWith(
				'ไม่สามารถบันทึก Override SOP ได้ — กรุณาลองใหม่อีกครั้ง'
			);
		});

		it('should short-circuit and return early if changes are identical to prev ratios', async () => {
			const mutation = useCreateOverrideVersion();
			const noOpInput = {
				...validOverrideInput,
				changes: {
					water_l_per_person_day: 15
				}
			};

			const result = await mutation.mutate(noOpInput);

			expect(mockCreateVersion).not.toHaveBeenCalled();
			expect(result).toEqual({
				profile: validOverrideInput.prev,
				deactivatedPrev: null,
				audit: null
			});
		});

		it('should short-circuit and return early if changes is an empty object', async () => {
			const mutation = useCreateOverrideVersion();
			const emptyInput = {
				...validOverrideInput,
				changes: {}
			};

			const result = await mutation.mutate(emptyInput);

			expect(mockCreateVersion).not.toHaveBeenCalled();
			expect(result).toEqual({
				profile: validOverrideInput.prev,
				deactivatedPrev: null,
				audit: null
			});
		});
	});

	describe('useCreateMasterVersion', () => {
		const validMasterInput = {
			prev: {
				_id: 'sop_profile:baseline',
				_rev: '1-abc',
				name: 'Sphere baseline',
				version: 1,
				active: true,
				/* Intentional schema_v bump (Master v3 / Override v2) explicitly overrides CR-021 wording 
				   to enforce strict compliance with CR-006 structural amendments (2026-06-25), 
				   preventing silent un-marshaling failures in PouchDB. */
				type: 'sop_profile' as const,
				schema_v: SOP_MASTER_SCHEMA_VERSION as SopMaster['schema_v'],
				created_at: '2026-07-03T00:00:00.000Z',
				updated_at: '2026-07-03T00:00:00.000Z',
				created_by: 'tester',
				ratios: mockRatios
			},
			changes: {
				water_l_per_person_day: 20
			},
			reason: 'Test change',
			createdBy: 'tester'
		};

		it('should succeed, call repository, and invalidate query cache on success', async () => {
			const mutation = useCreateMasterVersion();
			await mutation.mutate(validMasterInput);

			expect(mockCreateVersion).toHaveBeenCalled();
			expect(mockInvalidateQueries).toHaveBeenCalledWith({
				queryKey: sopRatioKeys.all
			});
			expect(toast.success).toHaveBeenCalledWith('บันทึกเวอร์ชัน Master SOP สำเร็จ');
		});

		it('should short-circuit and return early if changes are identical to prev ratios', async () => {
			const mutation = useCreateMasterVersion();
			const noOpInput = {
				...validMasterInput,
				changes: {
					water_l_per_person_day: 15
				}
			};

			const result = await mutation.mutate(noOpInput);

			expect(mockCreateVersion).not.toHaveBeenCalled();
			expect(result).toEqual({
				profile: validMasterInput.prev,
				deactivatedPrev: null,
				audit: null
			});
		});
	});

	describe('useMasterVersionHistory', () => {
		it('should return enabled: false when name is empty or whitespace', () => {
			expect(useMasterVersionHistory('')).toMatchObject({ enabled: false });
			expect(useMasterVersionHistory('   ')).toMatchObject({ enabled: false });
		});

		it('should return enabled: true and correct queryKey for valid name', () => {
			const result = useMasterVersionHistory('baseline');
			expect(result).toMatchObject({
				enabled: true,
				queryKey: [...sopVersionKeys.master(), 'baseline']
			});
		});
	});

	describe('useOverrideVersionHistory', () => {
		it('should return enabled: false when name is empty or whitespace', () => {
			expect(useOverrideVersionHistory('')).toMatchObject({ enabled: false });
			expect(useOverrideVersionHistory('   ')).toMatchObject({ enabled: false });
		});

		it('should return enabled: true and correctly scoped queryKey for valid name', () => {
			const result = useOverrideVersionHistory('baseline');
			expect(result).toMatchObject({
				enabled: true,
				queryKey: [...sopVersionKeys.override(), 'baseline', SHELTER_CODE]
			});
		});
	});
});
