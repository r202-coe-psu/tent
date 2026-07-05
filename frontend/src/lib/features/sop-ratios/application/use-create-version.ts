/**
 * use-create-version.ts — TanStack Query mutation hooks for SOP version creation (T-30.5)
 *
 * Provides mutations for creating new SOP profile versions (both master and override).
 * Each mutation:
 *   1. Calls the domain factory (`createNewVersion`) to build the new doc + deactivated prev + audit
 *   2. Persists via the PouchDB repository (`createVersion` — bulkDocs atomic write)
 *   3. Invalidates the sop_ratios query key family → UI refetches automatically
 *
 * Domain logic (immutability, idempotent no-op detection, audit trail generation)
 * is handled entirely in `domain/sop-ratio.ts` — this file orchestrates only.
 *
 * Source references:
 *   - sop-ratio.ts → createNewVersion, type SopMaster, type SopOverride, SOP_RATIO_KEYS
 *   - sop-ratio.repository.ts → SopMasterRepository.createVersion, SopOverrideRepository.createVersion
 *   - sop-ratio.pouch.ts → sopMasterRepository(), sopOverrideRepository()
 *   - CONVENTIONS.md §8 "Mutation hooks" + toast feedback §9
 *   - CR-006 §ทุก edit = new version + audit
 *   - CR-015 §Mutability: LWW, ห้าม overwrite direct
 *
 * ⚠️  CR-021 note: The `changes` input type is `Partial<Record<SopRatioKey, number>>`.
 *     When CR-021 lands (20 keys), no change is needed here — the domain layer handles
 *     the whitelist filtering. callers simply pass whatever keys changed.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { SHELTER_CODE } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { createNewVersion, createInitialProfile } from '../domain/sop-ratio';
import type { SopMaster, SopOverride, SopRatioKey } from '../domain/sop-ratio';
import { sopMasterRepository, sopOverrideRepository } from '../data/sop-ratio.pouch';
import { sopRatioKeys } from './queries';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateMasterVersionInput {
	/** The current active master profile to create a new version from. */
	prev: SopMaster;
	/** Only the changed ratio keys need to be provided — others are preserved from prev. */
	changes: Partial<Record<SopRatioKey, number>>;
	/** Free-text reason for the audit trail — mandatory per CR-006. */
	reason: string;
	/** Who is making this change (from the auth session). */
	createdBy: string;
}

export interface CreateOverrideVersionInput {
	/** The current active override to create a new version from. */
	prev: SopOverride;
	/** Only the changed ratio keys need to be provided. */
	changes: Partial<Record<SopRatioKey, number>>;
	reason: string;
	/** Full AuthorContext — shelterCode is mandatory for override auditing. */
	ctx: AuthorContext;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Mutation hook for creating a new version of the **master** SOP profile.
 *
 * Only `system_admin` should be permitted to call this; route-level RBAC guard is
 * enforced in `routes/(protected)/sop-ratios/+page.ts` (requireAdmin).
 *
 * Idempotent no-op: if `changes` produce no actual diff, `createNewVersion` returns
 * the same profile with null audit — `createVersion` still succeeds (saves only profile).
 *
 * Usage in a Svelte component (edit form onSuccess):
 * ```svelte
 * <script lang="ts">
 *   import { useCreateMasterVersion } from '$lib/features/sop-ratios';
 *
 *   const mutation = useCreateMasterVersion();
 *
 *   function handleSave(prev: SopMaster, changes: Partial<Record<SopRatioKey, number>>) {
 *     $mutation.mutate({ prev, changes, reason: 'Updated water ratio', createdBy: user.id });
 *   }
 * </script>
 * ```
 */
export function useCreateMasterVersion() {
	const queryClient = useQueryClient();

	return createMutation(() => ({
		mutationFn: async ({ prev, changes, reason, createdBy }: CreateMasterVersionInput) => {
			// If changes is empty {}, Object.keys yields [] and hasChanges is false.
			// This safely treats an empty payload as an implicit no-op branch.
			const hasChanges = Object.keys(changes).some((key) => {
				const val = changes[key as SopRatioKey];
				return val !== undefined && prev.ratios[key as SopRatioKey] !== val;
			});
			if (!hasChanges) {
				return { profile: prev, deactivatedPrev: null, audit: null };
			}

			// Step 1: Domain — pure function, no I/O.
			const result = createNewVersion(prev, changes, reason, { createdBy });

			// Step 2: Persist — atomic bulkDocs write via PouchDB repository.
			// saveBulkAtomic inside createVersion handles MVCC 409 retry.
			return sopMasterRepository().createVersion(
				result.deactivatedPrev,
				result.profile,
				result.audit
			);
		},

		onSuccess: () => {
			// Invalidate all sop_ratios queries so active ratio + history drawer refetch.
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success('บันทึกเวอร์ชัน Master SOP สำเร็จ');
		},

		onError: () => {
			toast.error('ไม่สามารถบันทึก Master SOP ได้ — กรุณาลองใหม่อีกครั้ง');
		}
	}));
}

/**
 * Mutation hook for creating a new version of the current shelter's **override** SOP profile.
 *
 * `shelter_manager` role is required; route-level guard enforced in the override route.
 * Override is always scoped to `SHELTER_CODE` — the shelterCode in ctx MUST match.
 *
 * Usage in a Svelte component:
 * ```svelte
 * <script lang="ts">
 *   import { useCreateOverrideVersion } from '$lib/features/sop-ratios';
 *   import { SHELTER_CODE } from '$lib/db/shelter';
 *
 *   const mutation = useCreateOverrideVersion();
 *
 *   function handleSave(prev: SopOverride, changes: Partial<Record<SopRatioKey, number>>) {
 *     $mutation.mutate({
 *       prev,
 *       changes,
 *       reason: 'ปรับอัตราน้ำประจำศูนย์',
 *       ctx: { shelterCode: SHELTER_CODE, createdBy: user.id }
 *     });
 *   }
 * </script>
 * ```
 */
export function useCreateOverrideVersion(shelterCode?: string) {
	const code = shelterCode ?? SHELTER_CODE;
	const queryClient = useQueryClient();

	return createMutation(() => ({
		mutationFn: async ({ prev, changes, reason, ctx }: CreateOverrideVersionInput) => {
			// Guard: prevent cross-shelter writes — ctx.shelterCode must match current shelter.
			// This is a defense-in-depth check; the route guard should prevent unauthorized access.
			if (ctx.shelterCode !== code) {
				throw new Error(`shelterCode mismatch: expected ${code}, got ${ctx.shelterCode}`);
			}

			// If changes is empty {}, Object.keys yields [] and hasChanges is false.
			// This safely treats an empty payload as an implicit no-op branch.
			const hasChanges = Object.keys(changes).some((key) => {
				const val = changes[key as SopRatioKey];
				return val !== undefined && prev.ratios[key as SopRatioKey] !== val;
			});
			if (!hasChanges) {
				return { profile: prev, deactivatedPrev: null, audit: null };
			}

			const result = createNewVersion(prev, changes, reason, ctx);

			return sopOverrideRepository(code).createVersion(
				result.deactivatedPrev,
				result.profile,
				result.audit
			);
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success('บันทึกเวอร์ชัน Override SOP สำเร็จ');
		},

		onError: () => {
			toast.error('ไม่สามารถบันทึก Override SOP ได้ — กรุณาลองใหม่อีกครั้ง');
		}
	}));
}

export interface CreateInitialOverrideInput {
	name: string;
	ratios: Record<SopRatioKey, number>;
	ctx: AuthorContext & { base_profile_id: string };
}

export function useCreateInitialOverride(shelterCode?: string) {
	const code = shelterCode ?? SHELTER_CODE;
	const queryClient = useQueryClient();

	return createMutation(() => ({
		mutationFn: async ({ name, ratios, ctx }: CreateInitialOverrideInput) => {
			if (ctx.shelterCode !== code) {
				throw new Error(`shelterCode mismatch: expected ${code}, got ${ctx.shelterCode}`);
			}
			const { profile, audit } = createInitialProfile('sop_override', name, ratios, ctx);
			return sopOverrideRepository(code).createVersion(null, profile, audit);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success('สร้างค่าปรับแต่งเฉพาะศูนย์สำเร็จ');
		},
		onError: () => {
			toast.error('ไม่สามารถสร้างค่าปรับแต่งเฉพาะศูนย์ได้ — กรุณาลองใหม่อีกครั้ง');
		}
	}));
}

export function useSetMasterActive() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, createdBy }: { id: string; createdBy: string }) => {
			return sopMasterRepository().setActive(id, { createdBy });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success('เปิดใช้งานเวอร์ชัน Master SOP สำเร็จ');
		},
		onError: () => {
			toast.error('ไม่สามารถเปิดใช้งาน Master SOP ได้');
		}
	}));
}

export function useSetOverrideActive(shelterCode?: string) {
	const code = shelterCode ?? SHELTER_CODE;
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, ctx }: { id: string; ctx: AuthorContext }) => {
			if (ctx.shelterCode !== code) {
				throw new Error(`shelterCode mismatch: expected ${code}, got ${ctx.shelterCode}`);
			}
			return sopOverrideRepository(code).setActive(id, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success('เปิดใช้งานเวอร์ชัน Override SOP สำเร็จ');
		},
		onError: () => {
			toast.error('ไม่สามารถเปิดใช้งาน Override SOP ได้');
		}
	}));
}

export function useSetOverrideInactive(shelterCode?: string) {
	const code = shelterCode ?? SHELTER_CODE;
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, ctx }: { id: string; ctx: AuthorContext }) => {
			if (ctx.shelterCode !== code) {
				throw new Error(`shelterCode mismatch: expected ${code}, got ${ctx.shelterCode}`);
			}
			return sopOverrideRepository(code).setInactive(id, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success('ยกเลิกค่าปรับแต่งเฉพาะศูนย์สำเร็จ (กลับไปใช้ค่ามาตรฐาน EOC)');
		},
		onError: () => {
			toast.error('ไม่สามารถยกเลิกค่าปรับแต่งเฉพาะศูนย์ได้');
		}
	}));
}
