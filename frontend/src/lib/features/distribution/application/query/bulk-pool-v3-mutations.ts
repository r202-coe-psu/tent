/**
 * Bulk return pool v3 mutations (issue #659): open / update header / add entries / move entry /
 * void entry / cancel pool; issue #660: submit pool / receive pool.
 *
 * Idempotency: operation ULIDs are CALLER-owned. The UI must create the ULID once per user action
 * with `createStableOperationId()` and reuse the same value when that action is retried, so the
 * workflow can recognise the replay. Never create a new ULID inside a retry loop.
 * Only receive writes stock (stock_ledger rows), so only it also invalidates inventory queries;
 * submit writes the pool header only.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { resolveAuthenticatedAuthorContext, resolveShelterCode } from './shared';
import {
	invalidateBulkPoolsV3,
	invalidateDistributionLogs,
	invalidateInventoryQueries,
	invalidateReturnerOutstandingLoans
} from './invalidation';
import type { BulkReturnPoolV3 } from '../../domain/food-supplies';
import {
	openBulkReturnPool,
	updateBulkReturnPoolHeader,
	cancelBulkReturnPool,
	submitBulkReturnPool,
	receiveBulkReturnPool,
	type ReceiveBulkReturnPoolInput,
	type ReceiveBulkReturnPoolResult,
	type OpenBulkReturnPoolInput,
	type UpdateBulkReturnPoolHeaderPatch
} from '../food-supplies/bulk-return-pool-v3-lifecycle';
import {
	addBulkReturnEntries,
	type AddBulkReturnEntriesInput,
	type AddBulkReturnEntriesResult
} from '../food-supplies/bulk-return-pool-v3-add-entry';
import {
	moveBulkReturnEntry,
	type MoveBulkReturnEntryInput,
	type MoveBulkReturnEntryResult
} from '../food-supplies/bulk-return-pool-v3-move';
import {
	voidBulkReturnEntry,
	type VoidBulkReturnEntryInput,
	type VoidBulkReturnEntryResult
} from '../food-supplies/bulk-return-pool-v3-void';

export interface OpenBulkReturnPoolMutationInput {
	input: OpenBulkReturnPoolInput;
	/** Created once per user action (`createStableOperationId`) and reused on retry. */
	operationUlid: string;
	shelterCode?: string;
}

export interface UpdateBulkReturnPoolHeaderMutationInput {
	poolId: string;
	patch: UpdateBulkReturnPoolHeaderPatch;
	shelterCode?: string;
}

export interface AddBulkReturnEntriesMutationInput {
	/** Each `input.items[].operationUlid` must be stable across retries of the same click. */
	input: AddBulkReturnEntriesInput;
	shelterCode?: string;
}

export interface MoveBulkReturnEntryMutationInput {
	input: MoveBulkReturnEntryInput;
	shelterCode?: string;
}

export interface VoidBulkReturnEntryMutationInput {
	input: VoidBulkReturnEntryInput;
	shelterCode?: string;
}

export interface CancelBulkReturnPoolMutationInput {
	poolId: string;
	/** Created once per user action (`createStableOperationId`) and reused on retry. */
	operationUlid: string;
	shelterCode?: string;
}

export interface SubmitBulkReturnPoolMutationInput {
	poolId: string;
	/** Created once per user action (`createStableOperationId`) and reused on retry. */
	operationUlid: string;
	shelterCode?: string;
}

export interface ReceiveBulkReturnPoolMutationInput {
	poolId: string;
	input: ReceiveBulkReturnPoolInput;
	/** Created once per user action (`createStableOperationId`) and reused on retry. */
	operationUlid: string;
	shelterCode?: string;
}

/** Opens an empty v3 pool. The pool id derives from `operationUlid`, so a retry is idempotent. */
export const useOpenBulkReturnPool = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			operationUlid,
			shelterCode
		}: OpenBulkReturnPoolMutationInput): Promise<BulkReturnPoolV3> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return openBulkReturnPool(input, operationUlid, ctx);
		},
		retry: false,
		onSuccess: (_data: BulkReturnPoolV3, variables: OpenBulkReturnPoolMutationInput) => {
			invalidateBulkPoolsV3(queryClient, resolveShelterCode(variables.shelterCode));
		}
	}));
};

/** Edits name / location / notes of an OPEN, unlocked pool. */
export const useUpdateBulkReturnPoolHeader = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			poolId,
			patch,
			shelterCode
		}: UpdateBulkReturnPoolHeaderMutationInput): Promise<BulkReturnPoolV3> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return updateBulkReturnPoolHeader(poolId, patch, ctx);
		},
		retry: false,
		onSuccess: (_data: BulkReturnPoolV3, variables: UpdateBulkReturnPoolHeaderMutationInput) => {
			invalidateBulkPoolsV3(queryClient, resolveShelterCode(variables.shelterCode));
		}
	}));
};

/** Records drop-offs into a pool and applies them to the returner's loans. */
export const useAddBulkReturnEntries = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			shelterCode
		}: AddBulkReturnEntriesMutationInput): Promise<AddBulkReturnEntriesResult> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return addBulkReturnEntries(input, ctx);
		},
		retry: false,
		onSuccess: (
			_data: AddBulkReturnEntriesResult,
			variables: AddBulkReturnEntriesMutationInput
		) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateBulkPoolsV3(queryClient, shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode);
			invalidateReturnerOutstandingLoans(queryClient, shelterCode);
		}
	}));
};

/**
 * Moves a whole entry to another OPEN pool. A late entry's loans are applied by the move, so logs
 * and outstanding loans are invalidated too (closed-loan-refs sit under the v3 pool prefix).
 */
export const useMoveBulkReturnEntry = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			shelterCode
		}: MoveBulkReturnEntryMutationInput): Promise<MoveBulkReturnEntryResult> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return moveBulkReturnEntry(input, ctx);
		},
		retry: false,
		onSuccess: (_data: MoveBulkReturnEntryResult, variables: MoveBulkReturnEntryMutationInput) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateBulkPoolsV3(queryClient, shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode);
			invalidateReturnerOutstandingLoans(queryClient, shelterCode);
		}
	}));
};

/**
 * Voids an entry and reopens the loans it actually closed (`loansReverted` lists only those; an
 * entry whose refs were never applied reverts nothing).
 */
export const useVoidBulkReturnEntry = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			input,
			shelterCode
		}: VoidBulkReturnEntryMutationInput): Promise<VoidBulkReturnEntryResult> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return voidBulkReturnEntry(input, ctx);
		},
		retry: false,
		onSuccess: (_data: VoidBulkReturnEntryResult, variables: VoidBulkReturnEntryMutationInput) => {
			const shelterCode = resolveShelterCode(variables.shelterCode);
			invalidateBulkPoolsV3(queryClient, shelterCode);
			invalidateDistributionLogs(queryClient, shelterCode);
			invalidateReturnerOutstandingLoans(queryClient, shelterCode);
		}
	}));
};

/** Submits an OPEN pool to the warehouse (OPEN -> SUBMITTED); writes no stock. */
export const useSubmitBulkReturnPool = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			poolId,
			operationUlid,
			shelterCode
		}: SubmitBulkReturnPoolMutationInput): Promise<BulkReturnPoolV3> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return submitBulkReturnPool(poolId, operationUlid, ctx);
		},
		retry: false,
		onSuccess: (_data: BulkReturnPoolV3, variables: SubmitBulkReturnPoolMutationInput) => {
			invalidateBulkPoolsV3(queryClient, resolveShelterCode(variables.shelterCode));
		}
	}));
};

/** Confirms a SUBMITTED pool at the warehouse (SUBMITTED -> RECEIVED) and books the stock. */
export const useReceiveBulkReturnPool = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			poolId,
			input,
			operationUlid,
			shelterCode
		}: ReceiveBulkReturnPoolMutationInput): Promise<ReceiveBulkReturnPoolResult> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return receiveBulkReturnPool(poolId, input, operationUlid, ctx);
		},
		retry: false,
		onSuccess: (
			_data: ReceiveBulkReturnPoolResult,
			variables: ReceiveBulkReturnPoolMutationInput
		) => {
			invalidateBulkPoolsV3(queryClient, resolveShelterCode(variables.shelterCode));
			invalidateInventoryQueries(queryClient);
		}
	}));
};

/** Cancels an EMPTY pool (OPEN -> CANCELLED). */
export const useCancelBulkReturnPool = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			poolId,
			operationUlid,
			shelterCode
		}: CancelBulkReturnPoolMutationInput): Promise<BulkReturnPoolV3> => {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return cancelBulkReturnPool(poolId, operationUlid, ctx);
		},
		retry: false,
		onSuccess: (_data: BulkReturnPoolV3, variables: CancelBulkReturnPoolMutationInput) => {
			invalidateBulkPoolsV3(queryClient, resolveShelterCode(variables.shelterCode));
		}
	}));
};
