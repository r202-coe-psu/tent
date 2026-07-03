// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import { useCreateMasterVersion, useCreateOverrideVersion } from './use-create-version';
import { sopRatioKeys } from './queries';
import { SHELTER_CODE } from '$lib/db/shelter';

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
	useQueryClient: () => ({
		invalidateQueries: mockInvalidateQueries
	}),
	createMutation: (fn: any) => {
		const options = fn();
		return {
			mutate: async (variables: any) => {
				try {
					const data = await options.mutationFn(variables);
					if (options.onSuccess) {
						options.onSuccess(data, variables);
					}
					return data;
				} catch (err) {
					if (options.onError) {
						options.onError(err, variables);
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

	describe('useCreateOverrideVersion', () => {
		const validOverrideInput = {
			prev: {
				_id: 'sop_override:SH001:baseline',
				_rev: '1-abc',
				name: 'Sphere baseline',
				version: 1,
				active: true,
				type: 'sop_override' as const,
				schema_v: 1 as const,
				shelter_code: SHELTER_CODE,
				base_profile_id: 'sop_profile:baseline',
				created_at: '2026-07-03T00:00:00.000Z',
				updated_at: '2026-07-03T00:00:00.000Z',
				created_by: 'tester',
				ratios: {
					water_l_per_person_day: 15,
					rice_g_per_person_meal: 200,
					toilet_per_person: 0.05
				}
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
			expect(toast.error).toHaveBeenCalledWith('ไม่สามารถบันทึก Override SOP ได้ — กรุณาลองใหม่อีกครั้ง');
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
				type: 'sop_profile' as const,
				schema_v: 2 as const,
				created_at: '2026-07-03T00:00:00.000Z',
				updated_at: '2026-07-03T00:00:00.000Z',
				created_by: 'tester',
				ratios: {
					water_l_per_person_day: 15,
					rice_g_per_person_meal: 200,
					toilet_per_person: 0.05
				}
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
});
