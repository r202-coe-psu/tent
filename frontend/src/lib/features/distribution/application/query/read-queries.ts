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
			queryKey: ['return-operation-state', shelterCode, id],
			queryFn: async () => {
				const { getReturnOperationState } = await import('../food-supplies/return-workflow');
				const ctx = resolveAuthenticatedAuthorContext(shelterCode);
				return getReturnOperationState(id!, ctx);
			},
			enabled: isEnabled,
			refetchInterval: 3000
		};
	});
