/**
 * Read query hooks for Distribution entities and live calculations.
 */

import { createQuery } from '@tanstack/svelte-query';
import { distributionKeys } from './keys';
import {
	type MaybeGetter,
	toValue,
	resolveShelterCode,
	resolveAuthenticatedAuthorContext
} from './shared';
import {
	requisitionTicketRepository,
	distributionLogRepository,
	bulkReturnPoolRepository,
	bulkReturnClaimRepository
} from './repositories';
import { calculateShiftReconciliation } from '../food-supplies/reconciliation-workflow';
import { resolveDispatchedLotExpiry } from '../food-supplies/lot-expiry';
import { operationsRepository } from '$lib/features/operations';
import { getReturnOperationState } from '../food-supplies/return-workflow';
import {
	getBulkReturnPoolOverview,
	getBulkReturnPoolTimeline,
	listBulkReturnPoolAppliedLoanRefs,
	listBulkReturnPoolClosedLoanRefs,
	listReturnerOutstandingLoans,
	listBulkReturnSkippedDocs,
	type BulkReturnPoolOverviewQuery
} from '../food-supplies/bulk-return-pool-v3-read';
import type {
	RequisitionTicketListFilter,
	DistributionLogListFilter,
	BulkReturnPoolListFilter
} from '../../data/food-supplies';

/** Lists requisition tickets matching optional status/type filters. */
export const useRequisitionTickets = (
	filter?: MaybeGetter<RequisitionTicketListFilter | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const resolvedFilter = toValue(filter);
		const isEnabled = Boolean(toValue(enabled) && shelterCode);
		return {
			queryKey: distributionKeys.tickets(shelterCode, resolvedFilter),
			queryFn: () => requisitionTicketRepository(shelterCode).list(resolvedFilter),
			enabled: isEnabled
		};
	});

/** Reads a single requisition ticket by ID. */
export const useRequisitionTicket = (
	ticketId: MaybeGetter<string>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(ticketId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && id && shelterCode);
		return {
			queryKey: distributionKeys.ticket(shelterCode, id),
			queryFn: () => requisitionTicketRepository(shelterCode).get(id),
			enabled: isEnabled
		};
	});

/** Lists distribution logs matching optional ticket/recipient/status filters. */
export const useDistributionLogs = (
	filter?: MaybeGetter<DistributionLogListFilter | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const resolvedFilter = toValue(filter);
		const isEnabled = Boolean(toValue(enabled) && shelterCode);
		return {
			queryKey: distributionKeys.logs(shelterCode, resolvedFilter),
			queryFn: () => distributionLogRepository(shelterCode).list(resolvedFilter),
			enabled: isEnabled
		};
	});

/**
 * `lot.expiry` of the lot dispatched for a ticket item — the ready-meal safety clock
 * (FR-MQW-06 B). `null` when unknown. Lot metadata never changes after dispatch.
 */
export const useDispatchedLotExpiry = (
	ticketId: MaybeGetter<string>,
	itemId: MaybeGetter<string>,
	shelterCodeGetter?: MaybeGetter<string | undefined>
) =>
	createQuery(() => {
		const ticket = toValue(ticketId);
		const item = toValue(itemId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		return {
			queryKey: distributionKeys.dispatchedLotExpiry(shelterCode, ticket, item),
			queryFn: async () =>
				(await resolveDispatchedLotExpiry(ticket, item, operationsRepository(shelterCode))) ?? null,
			enabled: Boolean(ticket && item && shelterCode),
			staleTime: Infinity
		};
	});

/** Reads a single distribution log by ID. */
export const useDistributionLog = (
	logId: MaybeGetter<string>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(logId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && id && shelterCode);
		return {
			queryKey: distributionKeys.log(shelterCode, id),
			queryFn: () => distributionLogRepository(shelterCode).get(id),
			enabled: isEnabled
		};
	});

/** Lists bulk return pools (CR-134). */
export const useBulkReturnPools = (
	filter?: MaybeGetter<BulkReturnPoolListFilter | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const resolvedFilter = toValue(filter);
		const isEnabled = Boolean(toValue(enabled) && shelterCode);
		return {
			queryKey: distributionKeys.bulkPools(shelterCode, resolvedFilter),
			queryFn: () => bulkReturnPoolRepository(shelterCode).list(resolvedFilter),
			enabled: isEnabled
		};
	});

/** Reads a single bulk return pool by ID. */
export const useBulkReturnPool = (
	poolId: MaybeGetter<string>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(poolId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && id && shelterCode);
		return {
			queryKey: distributionKeys.bulkPool(shelterCode, id),
			queryFn: () => bulkReturnPoolRepository(shelterCode).get(id),
			enabled: isEnabled
		};
	});

/** Reads the v3 bulk return pool overview (pools with entries, item totals, late entries). */
export const useBulkReturnPoolOverview = (
	options?: MaybeGetter<BulkReturnPoolOverviewQuery | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const resolvedOptions = toValue(options);
		const isEnabled = Boolean(toValue(enabled) && shelterCode);
		return {
			queryKey: distributionKeys.bulkPoolsV3(shelterCode, resolvedOptions),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return getBulkReturnPoolOverview(resolvedOptions ?? {}, ctx);
			},
			enabled: isEnabled
		};
	});

/**
 * Reads the loan-drift warning refs of a pool: refs of its live entries whose loan was closed /
 * has too little outstanding / is missing, so they were not applied (derived at read time).
 */
export const useBulkReturnPoolClosedLoanRefs = (
	poolId: MaybeGetter<string | null | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(poolId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && shelterCode && id);
		return {
			queryKey: distributionKeys.bulkPoolClosedLoanRefs(shelterCode, id ?? ''),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return listBulkReturnPoolClosedLoanRefs(id!, ctx);
			},
			enabled: isEnabled
		};
	});

/**
 * Reads the refs of a pool's live entries that are actually applied on their loan
 * (`applied_bulk_entry_ids`); derived at read time.
 */
export const useBulkReturnPoolAppliedLoanRefs = (
	poolId: MaybeGetter<string | null | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(poolId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && shelterCode && id);
		return {
			queryKey: distributionKeys.bulkPoolAppliedLoanRefs(shelterCode, id ?? ''),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return listBulkReturnPoolAppliedLoanRefs(id!, ctx);
			},
			enabled: isEnabled
		};
	});

/** Reads the chronological timeline of one bulk return pool (events + skipped docs). */
export const useBulkReturnPoolTimeline = (
	poolId: MaybeGetter<string | null | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(poolId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && shelterCode && id);
		return {
			queryKey: distributionKeys.bulkPoolTimeline(shelterCode, id ?? ''),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return getBulkReturnPoolTimeline(id!, ctx);
			},
			enabled: isEnabled
		};
	});

/** Reads the outstanding returnable loans of an evacuee/volunteer returner (all items, oldest first). */
export const useReturnerOutstandingLoans = (
	returnerId: MaybeGetter<string | null | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(returnerId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(
			toValue(enabled) &&
			shelterCode &&
			id &&
			(id.startsWith('evacuee:') || id.startsWith('volunteer:'))
		);
		return {
			queryKey: distributionKeys.returnerOutstandingLoans(shelterCode, id ?? ''),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return listReturnerOutstandingLoans(id!, ctx);
			},
			enabled: isEnabled
		};
	});

/**
 * Reads the malformed docs the bulk return reads (pool overview, and with `returnerId` that
 * returner's loans) left out, so the UI can warn that the list is incomplete.
 */
export const useBulkReturnSkippedDocs = (
	returnerId?: MaybeGetter<string | null | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(returnerId) || undefined;
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const validReturner = !id || id.startsWith('evacuee:') || id.startsWith('volunteer:');
		const isEnabled = Boolean(toValue(enabled) && shelterCode && validReturner);
		return {
			queryKey: distributionKeys.bulkReturnSkippedDocs(shelterCode, id),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return listBulkReturnSkippedDocs({ returnerId: id }, ctx);
			},
			enabled: isEnabled
		};
	});

/** Reads a single bulk return claim by ID (CR-134). */
export const useBulkReturnClaim = (
	claimId: MaybeGetter<string>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(claimId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && id && shelterCode);
		return {
			queryKey: distributionKeys.bulkClaim(shelterCode, id),
			queryFn: () => bulkReturnClaimRepository(shelterCode).get(id),
			enabled: isEnabled
		};
	});

/** Reads dynamic live shift reconciliation calculated directly from ticket and distribution logs (Workflow 15). */
export const useShiftReconciliation = (
	ticketId: MaybeGetter<string>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(ticketId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && id && shelterCode);
		return {
			queryKey: distributionKeys.shiftReconciliation(shelterCode, id),
			queryFn: () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return calculateShiftReconciliation(id, ctx);
			},
			enabled: isEnabled
		};
	});

/** Reads authoritative in-flight or recovery operation state for a loan return (CR-134 R4). */
export const useReturnOperationState = (
	logId: MaybeGetter<string | null | undefined>,
	shelterCodeGetter?: MaybeGetter<string | undefined>,
	enabled: MaybeGetter<boolean> = true
) =>
	createQuery(() => {
		const id = toValue(logId);
		const shelterCode = resolveShelterCode(toValue(shelterCodeGetter));
		const isEnabled = Boolean(toValue(enabled) && id && shelterCode);
		return {
			queryKey: distributionKeys.returnOperationState(shelterCode, id!),
			queryFn: async () => {
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return getReturnOperationState(id!, ctx);
			},
			enabled: isEnabled,
			refetchInterval: 3000
		};
	});
