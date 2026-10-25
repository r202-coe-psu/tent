// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isUlid } from '$lib/db/ulid';

type MutationDefinition = {
	mutationFn: (variables: unknown) => Promise<unknown>;
	retry?: boolean;
	onSuccess?: (data: unknown, variables: unknown, context: unknown) => void;
};
type QueryDefinition = {
	queryKey: unknown;
	queryFn: () => Promise<unknown>;
	enabled?: boolean;
};

const {
	mockAuthUser,
	mockWorkflowCalls,
	mockRepoInstances,
	subscribeCalls,
	mockQueryClient,
	tracker
} = vi.hoisted(() => {
	const mockAuthUser = {
		name: 'staff_alice',
		roles: ['shelter:SH001', 'warehouse_staff', 'registration_staff']
	};

	const mockWorkflowCalls = {
		createRequisitionTicket: vi.fn(),
		allocateTicketItems: vi.fn(),
		approveTicketForDispatch: vi.fn(),
		cancelTicket: vi.fn(),
		dispatchTicket: vi.fn(),
		receiveTicketAtDistributionPoint: vi.fn(),
		amendActiveTicket: vi.fn(),
		recordFoodDistribution: vi.fn(),
		recordSuppliesDistribution: vi.fn(),
		voidDistributionLog: vi.fn(),
		returnLoanAtCounter: vi.fn(),
		clearLoanNonPhysical: vi.fn(),
		createBulkReturnPool: vi.fn(),
		clearLoanViaBulkPool: vi.fn(),
		calculateShiftReconciliation: vi.fn(),
		closeShift: vi.fn(),
		submitReturnsToWarehouse: vi.fn(),
		receiveWarehouseReturns: vi.fn(),
		completeTicket: vi.fn(),
		openBulkReturnPool: vi.fn(),
		updateBulkReturnPoolHeader: vi.fn(),
		addBulkReturnEntries: vi.fn(),
		moveBulkReturnEntry: vi.fn(),
		voidBulkReturnEntry: vi.fn(),
		cancelBulkReturnPool: vi.fn(),
		submitBulkReturnPool: vi.fn(),
		receiveBulkReturnPool: vi.fn(),
		getBulkReturnPoolOverview: vi.fn(),
		listReturnerOutstandingLoans: vi.fn(),
		listBulkReturnPoolClosedLoanRefs: vi.fn(),
		listBulkReturnPoolAppliedLoanRefs: vi.fn()
	};

	const mockRepoInstances = {
		ticketRepo: { list: vi.fn(), get: vi.fn() },
		logRepo: { list: vi.fn(), get: vi.fn() },
		poolRepo: { list: vi.fn(), get: vi.fn() },
		claimRepo: { get: vi.fn() }
	};

	const subscribeCalls: Array<{ keysForType: (t: string) => unknown[] }> = [];

	const mockQueryClient = {
		invalidateQueries: vi.fn()
	};

	const tracker: {
		lastCreatedMutation: MutationDefinition | null;
		lastCreatedQuery: QueryDefinition | null;
	} = {
		lastCreatedMutation: null,
		lastCreatedQuery: null
	};

	return {
		mockAuthUser,
		mockWorkflowCalls,
		mockRepoInstances,
		subscribeCalls,
		mockQueryClient,
		tracker
	};
});

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		user: mockAuthUser,
		isAuthenticated: true
	}
}));

// Mock shelterStore and shelter helpers
vi.mock('$lib/stores/shelter.svelte', () => ({
	shelterStore: {
		selectedShelterCode: 'SH001'
	}
}));

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: (code: string = 'SH001') => `shelter_${code.toLowerCase()}`,
	getShelterCode: () => 'SH001'
}));

// Mock operations query keys
vi.mock('$lib/features/operations', () => ({
	operationsKeys: {
		all: ['operations'] as const,
		stockLedgers: () => ['operations', 'stockLedgers'] as const,
		ledger: () => ['operations', 'ledger'] as const,
		balance: () => ['operations', 'balance', 'SH001'] as const
	}
}));

// Mock workflows
vi.mock('./food-supplies/ticket-workflow', () => ({
	createRequisitionTicket: (...args: unknown[]) =>
		mockWorkflowCalls.createRequisitionTicket(...args),
	allocateTicketItems: (...args: unknown[]) => mockWorkflowCalls.allocateTicketItems(...args),
	approveTicketForDispatch: (...args: unknown[]) =>
		mockWorkflowCalls.approveTicketForDispatch(...args),
	cancelTicket: (...args: unknown[]) => mockWorkflowCalls.cancelTicket(...args),
	receiveTicketAtDistributionPoint: (...args: unknown[]) =>
		mockWorkflowCalls.receiveTicketAtDistributionPoint(...args)
}));

vi.mock('./food-supplies/dispatch-workflow', () => ({
	dispatchTicket: (...args: unknown[]) => mockWorkflowCalls.dispatchTicket(...args),
	amendActiveTicket: (...args: unknown[]) => mockWorkflowCalls.amendActiveTicket(...args)
}));

vi.mock('./food-supplies/distribution-workflow', () => ({
	recordFoodDistribution: (...args: unknown[]) => mockWorkflowCalls.recordFoodDistribution(...args),
	recordSuppliesDistribution: (...args: unknown[]) =>
		mockWorkflowCalls.recordSuppliesDistribution(...args),
	voidDistributionLog: (...args: unknown[]) => mockWorkflowCalls.voidDistributionLog(...args)
}));

vi.mock('./food-supplies/return-workflow', () => ({
	returnLoanAtCounter: (...args: unknown[]) => mockWorkflowCalls.returnLoanAtCounter(...args),
	clearLoanNonPhysical: (...args: unknown[]) => mockWorkflowCalls.clearLoanNonPhysical(...args),
	createBulkReturnPool: (...args: unknown[]) => mockWorkflowCalls.createBulkReturnPool(...args),
	clearLoanViaBulkPool: (...args: unknown[]) => mockWorkflowCalls.clearLoanViaBulkPool(...args)
}));

vi.mock('./food-supplies/reconciliation-workflow', () => ({
	calculateShiftReconciliation: (...args: unknown[]) =>
		mockWorkflowCalls.calculateShiftReconciliation(...args),
	closeShift: (...args: unknown[]) => mockWorkflowCalls.closeShift(...args),
	submitReturnsToWarehouse: (...args: unknown[]) =>
		mockWorkflowCalls.submitReturnsToWarehouse(...args),
	receiveWarehouseReturns: (...args: unknown[]) =>
		mockWorkflowCalls.receiveWarehouseReturns(...args),
	completeTicket: (...args: unknown[]) => mockWorkflowCalls.completeTicket(...args)
}));

vi.mock('./food-supplies/bulk-return-pool-v3-workflow', () => ({
	openBulkReturnPool: (...args: unknown[]) => mockWorkflowCalls.openBulkReturnPool(...args),
	updateBulkReturnPoolHeader: (...args: unknown[]) =>
		mockWorkflowCalls.updateBulkReturnPoolHeader(...args),
	addBulkReturnEntries: (...args: unknown[]) => mockWorkflowCalls.addBulkReturnEntries(...args),
	moveBulkReturnEntry: (...args: unknown[]) => mockWorkflowCalls.moveBulkReturnEntry(...args),
	voidBulkReturnEntry: (...args: unknown[]) => mockWorkflowCalls.voidBulkReturnEntry(...args),
	cancelBulkReturnPool: (...args: unknown[]) => mockWorkflowCalls.cancelBulkReturnPool(...args),
	submitBulkReturnPool: (...args: unknown[]) => mockWorkflowCalls.submitBulkReturnPool(...args),
	receiveBulkReturnPool: (...args: unknown[]) => mockWorkflowCalls.receiveBulkReturnPool(...args),
	getBulkReturnPoolOverview: (...args: unknown[]) =>
		mockWorkflowCalls.getBulkReturnPoolOverview(...args),
	listReturnerOutstandingLoans: (...args: unknown[]) =>
		mockWorkflowCalls.listReturnerOutstandingLoans(...args),
	listBulkReturnPoolClosedLoanRefs: (...args: unknown[]) =>
		mockWorkflowCalls.listBulkReturnPoolClosedLoanRefs(...args),
	listBulkReturnPoolAppliedLoanRefs: (...args: unknown[]) =>
		mockWorkflowCalls.listBulkReturnPoolAppliedLoanRefs(...args)
}));

// Mock repositories
vi.mock('../data/food-supplies', () => ({
	RequisitionTicketRemoteRepository: vi.fn(function () {
		return mockRepoInstances.ticketRepo;
	}),
	DistributionLogRemoteRepository: vi.fn(function () {
		return mockRepoInstances.logRepo;
	}),
	BulkReturnPoolRemoteRepository: vi.fn(function () {
		return mockRepoInstances.poolRepo;
	}),
	BulkReturnClaimRemoteRepository: vi.fn(function () {
		return mockRepoInstances.claimRepo;
	})
}));

// Track subscribeDataChanges
vi.mock('$lib/db/subscribe-data-changes', () => ({
	subscribeDataChanges: (_qc: unknown, _db: unknown, keysForType: (t: string) => unknown[]) => {
		subscribeCalls.push({ keysForType });
		return { stop: vi.fn() };
	}
}));

// Capture TanStack query creation calls
vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => mockQueryClient,
	createQuery: (fn: () => QueryDefinition) => {
		const res = fn();
		tracker.lastCreatedQuery = res;
		return res;
	},
	createMutation: (fn: () => MutationDefinition) => {
		const res = fn();
		tracker.lastCreatedMutation = res;
		return res;
	}
}));

import { operationsKeys } from '$lib/features/operations';
import {
	distributionKeys,
	createStableOperationId,
	resolveAuthenticatedAuthorContext,
	useRequisitionTickets,
	useRequisitionTicket,
	useDistributionLogs,
	useDistributionLog,
	useBulkReturnPools,
	useBulkReturnPool,
	useBulkReturnPoolOverview,
	useBulkReturnPoolClosedLoanRefs,
	useBulkReturnPoolAppliedLoanRefs,
	useReturnerOutstandingLoans,
	useOpenBulkReturnPool,
	useUpdateBulkReturnPoolHeader,
	useAddBulkReturnEntries,
	useMoveBulkReturnEntry,
	useVoidBulkReturnEntry,
	useCancelBulkReturnPool,
	useSubmitBulkReturnPool,
	useReceiveBulkReturnPool,
	useShiftReconciliation,
	useCreateRequisitionTicket,
	useAllocateTicketItems,
	useApproveTicketForDispatch,
	useCancelTicket,
	useDispatchTicket,
	useReceiveTicketAtDistributionPoint,
	useAmendActiveTicket,
	useRecordFoodDistribution,
	useRecordSuppliesDistribution,
	useVoidDistributionLog,
	useReturnLoanAtCounter,
	useClearLoanNonPhysical,
	useCreateBulkReturnPool,
	useCloseShift,
	useSubmitReturnsToWarehouse,
	useReceiveWarehouseReturns,
	useCompleteTicket,
	startDistributionLiveQuery,
	invalidateTicketCollection,
	invalidateTicket,
	invalidateTicketWithCollection,
	invalidateDistributionLogs,
	invalidateShiftReconciliation,
	invalidateBulkClaims,
	invalidateInventoryQueries
} from './queries';
import { useBulkReturnClaim } from './query/read-queries';
import { useClearLoanViaBulkPool } from './query/return-mutations';
import { invalidateBulkPools } from './query/invalidation';

describe('Phase 5 Slice 5.0 — Distribution TanStack Query Layer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscribeCalls.length = 0;
		tracker.lastCreatedMutation = null;
		tracker.lastCreatedQuery = null;
		mockAuthUser.name = 'staff_alice';
		mockAuthUser.roles = ['shelter:SH001', 'warehouse_staff', 'registration_staff'];
	});

	describe('1. Centralized Query Key Hierarchy', () => {
		it('generates deterministic and serializable query keys for tickets', () => {
			expect(distributionKeys.all).toEqual(['distribution']);
			expect(distributionKeys.shelter('SH001')).toEqual(['distribution', 'SH001']);
			expect(distributionKeys.tickets('SH001')).toEqual(['distribution', 'SH001', 'tickets', {}]);
			expect(
				distributionKeys.tickets('SH001', { status: 'PENDING_PICK', requisition_type: 'food' })
			).toEqual([
				'distribution',
				'SH001',
				'tickets',
				{ status: 'PENDING_PICK', requisition_type: 'food' }
			]);
			expect(distributionKeys.ticket('SH001', 'tkt_01')).toEqual([
				'distribution',
				'SH001',
				'ticket',
				'tkt_01'
			]);
		});

		it('generates deterministic query keys for distribution logs and reconciliation', () => {
			expect(distributionKeys.logs('SH001')).toEqual(['distribution', 'SH001', 'logs', {}]);
			expect(distributionKeys.logs('SH001', { ticket_id: 'tkt_01' })).toEqual([
				'distribution',
				'SH001',
				'logs',
				{ ticket_id: 'tkt_01' }
			]);
			expect(distributionKeys.log('SH001', 'log_01')).toEqual([
				'distribution',
				'SH001',
				'log',
				'log_01'
			]);
			expect(distributionKeys.shiftReconciliation('SH001', 'tkt_01')).toEqual([
				'distribution',
				'SH001',
				'shift_reconciliation',
				'tkt_01'
			]);
		});

		it('generates deterministic query keys for bulk pools and claims', () => {
			expect(distributionKeys.bulkPools('SH001')).toEqual([
				'distribution',
				'SH001',
				'bulk_pools',
				{}
			]);
			expect(distributionKeys.bulkPool('SH001', 'pool_01')).toEqual([
				'distribution',
				'SH001',
				'bulk_pool',
				'pool_01'
			]);
			expect(distributionKeys.bulkClaims('SH001')).toEqual([
				'distribution',
				'SH001',
				'bulk_claims',
				{}
			]);
			expect(distributionKeys.bulkClaim('SH001', 'claim_01')).toEqual([
				'distribution',
				'SH001',
				'bulk_claim',
				'claim_01'
			]);
		});

		it('generates bulk pool v3 and returner outstanding-loan keys distinct from legacy pools', () => {
			expect(distributionKeys.bulkPoolsV3All('SH001')).toEqual([
				'distribution',
				'SH001',
				'bulk_pools_v3'
			]);
			expect(distributionKeys.bulkPoolsV3('SH001')).toEqual([
				'distribution',
				'SH001',
				'bulk_pools_v3',
				{ includeCancelled: false }
			]);
			expect(distributionKeys.bulkPoolsV3('SH001', {})).toEqual(
				distributionKeys.bulkPoolsV3('SH001', { includeCancelled: false })
			);
			expect(distributionKeys.bulkPoolsV3('SH001', { includeCancelled: true })).toEqual([
				'distribution',
				'SH001',
				'bulk_pools_v3',
				{ includeCancelled: true }
			]);
			expect(distributionKeys.returnerOutstandingLoansAll('SH001')).toEqual([
				'distribution',
				'SH001',
				'returner_outstanding_loans'
			]);
			expect(distributionKeys.returnerOutstandingLoans('SH001', 'evacuee:e1')).toEqual([
				'distribution',
				'SH001',
				'returner_outstanding_loans',
				'evacuee:e1'
			]);
		});

		it('generates the return-operation-state prefix nested under the shelter hierarchy', () => {
			expect(distributionKeys.returnOperationStates('SH001')).toEqual([
				'distribution',
				'SH001',
				'return_operation_state'
			]);
		});

		it('generates the return-operation-state leaf key nested under its own prefix', () => {
			expect(distributionKeys.returnOperationState('SH001', 'log_01')).toEqual([
				'distribution',
				'SH001',
				'return_operation_state',
				'log_01'
			]);
		});
	});

	describe('2. Stable Caller-Owned Operation IDs & Actor Context', () => {
		it('generates valid ULID operation IDs for idempotent workflows', () => {
			const opId1 = createStableOperationId();
			const opId2 = createStableOperationId();
			expect(isUlid(opId1)).toBe(true);
			expect(isUlid(opId2)).toBe(true);
			expect(opId1).not.toBe(opId2);
		});

		it('derives author context from authenticated session and fails closed when unauthenticated', () => {
			const ctx = resolveAuthenticatedAuthorContext();
			expect(ctx.shelterCode).toBe('SH001');
			expect(ctx.createdBy).toBe('staff_alice');
			expect(ctx.roles).toContain('warehouse_staff');

			// Fail closed when user is missing
			mockAuthUser.name = '';
			expect(() => resolveAuthenticatedAuthorContext()).toThrow(/Unauthenticated/);
		});
	});

	describe('3. Read Queries Binding & Conditional Execution', () => {
		it('useRequisitionTickets binds to repository list and executes correctly', async () => {
			mockRepoInstances.ticketRepo.list.mockResolvedValueOnce([{ _id: 'tkt_1' }]);
			const filter = { status: 'PENDING_PICK' as const, requisition_type: 'food' as const };
			useRequisitionTickets(filter);
			expect(tracker.lastCreatedQuery).toBeDefined();
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(distributionKeys.tickets('SH001', filter));

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ _id: 'tkt_1' }]);
			expect(mockRepoInstances.ticketRepo.list).toHaveBeenCalledWith(filter);
		});

		it('useRequisitionTicket respects conditional enabled and binds to repository get', async () => {
			useRequisitionTicket(() => '');
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockRepoInstances.ticketRepo.get.mockResolvedValueOnce({ _id: 'tkt_99' });
			useRequisitionTicket(() => 'tkt_99');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.ticket('SH001', 'tkt_99')
			);

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual({ _id: 'tkt_99' });
			expect(mockRepoInstances.ticketRepo.get).toHaveBeenCalledWith('tkt_99');
		});

		it('useDistributionLogs binds to repository list with filters', async () => {
			mockRepoInstances.logRepo.list.mockResolvedValueOnce([{ _id: 'log_1' }]);
			const filter = { ticket_id: 'tkt_01' };
			useDistributionLogs(filter);
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(distributionKeys.logs('SH001', filter));

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ _id: 'log_1' }]);
			expect(mockRepoInstances.logRepo.list).toHaveBeenCalledWith(filter);
		});

		it('useDistributionLog binds to repository get and respects conditional enabled', async () => {
			useDistributionLog(() => '');
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockRepoInstances.logRepo.get.mockResolvedValueOnce({ _id: 'log_99' });
			useDistributionLog(() => 'log_99');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(distributionKeys.log('SH001', 'log_99'));

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual({ _id: 'log_99' });
			expect(mockRepoInstances.logRepo.get).toHaveBeenCalledWith('log_99');
		});

		it('useBulkReturnPools binds to repository list with filters', async () => {
			mockRepoInstances.poolRepo.list.mockResolvedValueOnce([{ _id: 'pool_1' }]);
			const filter = { status: 'ACTIVE' as const };
			useBulkReturnPools(filter);
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.bulkPools('SH001', filter)
			);

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ _id: 'pool_1' }]);
			expect(mockRepoInstances.poolRepo.list).toHaveBeenCalledWith(filter);
		});

		it('useBulkReturnPool binds to repository get and respects conditional enabled', async () => {
			useBulkReturnPool(() => '');
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockRepoInstances.poolRepo.get.mockResolvedValueOnce({ _id: 'pool_99' });
			useBulkReturnPool(() => 'pool_99');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.bulkPool('SH001', 'pool_99')
			);

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual({ _id: 'pool_99' });
			expect(mockRepoInstances.poolRepo.get).toHaveBeenCalledWith('pool_99');
		});

		it('useBulkReturnClaim binds to repository get and respects conditional enabled', async () => {
			useBulkReturnClaim(() => '');
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockRepoInstances.claimRepo.get.mockResolvedValueOnce({ _id: 'claim_99' });
			useBulkReturnClaim(() => 'claim_99');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.bulkClaim('SH001', 'claim_99')
			);

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual({ _id: 'claim_99' });
			expect(mockRepoInstances.claimRepo.get).toHaveBeenCalledWith('claim_99');
		});

		it('useBulkReturnPoolOverview binds to the overview workflow with ctx', async () => {
			mockWorkflowCalls.getBulkReturnPoolOverview.mockResolvedValueOnce([{ pool: 'p' }]);
			const options = { includeCancelled: true };
			useBulkReturnPoolOverview(() => options);
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.bulkPoolsV3('SH001', options)
			);

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ pool: 'p' }]);
			expect(mockWorkflowCalls.getBulkReturnPoolOverview).toHaveBeenCalledWith(
				options,
				expect.objectContaining({ createdBy: 'staff_alice', shelterCode: 'SH001' })
			);

			useBulkReturnPoolOverview(undefined, undefined, false);
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);
		});

		it('useReturnerOutstandingLoans is enabled only for an evacuee:/volunteer: id', async () => {
			useReturnerOutstandingLoans(() => null);
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);
			useReturnerOutstandingLoans(() => 'person:p1');
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);
			useReturnerOutstandingLoans(() => 'volunteer:v1');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);

			mockWorkflowCalls.listReturnerOutstandingLoans.mockResolvedValueOnce([{ _id: 'log_1' }]);
			useReturnerOutstandingLoans(() => 'evacuee:e1');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.returnerOutstandingLoans('SH001', 'evacuee:e1')
			);

			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ _id: 'log_1' }]);
			expect(mockWorkflowCalls.listReturnerOutstandingLoans).toHaveBeenCalledWith(
				'evacuee:e1',
				expect.objectContaining({ createdBy: 'staff_alice', shelterCode: 'SH001' })
			);
		});

		it('useBulkReturnPoolClosedLoanRefs is keyed under the v3 prefix and needs a pool id', async () => {
			expect(distributionKeys.bulkPoolClosedLoanRefs('SH001', 'bulk_return_pool:p1')).toEqual([
				'distribution',
				'SH001',
				'bulk_pools_v3',
				'closed_loan_refs',
				'bulk_return_pool:p1'
			]);

			useBulkReturnPoolClosedLoanRefs(() => null);
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockWorkflowCalls.listBulkReturnPoolClosedLoanRefs.mockResolvedValueOnce([{ entry_id: 'e' }]);
			useBulkReturnPoolClosedLoanRefs(() => 'bulk_return_pool:p1');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ entry_id: 'e' }]);
			expect(mockWorkflowCalls.listBulkReturnPoolClosedLoanRefs).toHaveBeenCalledWith(
				'bulk_return_pool:p1',
				expect.objectContaining({ createdBy: 'staff_alice', shelterCode: 'SH001' })
			);
		});

		it('useBulkReturnPoolAppliedLoanRefs is keyed under the v3 prefix and needs a pool id', async () => {
			expect(distributionKeys.bulkPoolAppliedLoanRefs('SH001', 'bulk_return_pool:p1')).toEqual([
				'distribution',
				'SH001',
				'bulk_pools_v3',
				'applied_loan_refs',
				'bulk_return_pool:p1'
			]);

			useBulkReturnPoolAppliedLoanRefs(() => null);
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockWorkflowCalls.listBulkReturnPoolAppliedLoanRefs.mockResolvedValueOnce([
				{ entry_id: 'e' }
			]);
			useBulkReturnPoolAppliedLoanRefs(() => 'bulk_return_pool:p1');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			const result = await tracker.lastCreatedQuery?.queryFn();
			expect(result).toEqual([{ entry_id: 'e' }]);
			expect(mockWorkflowCalls.listBulkReturnPoolAppliedLoanRefs).toHaveBeenCalledWith(
				'bulk_return_pool:p1',
				expect.objectContaining({ createdBy: 'staff_alice', shelterCode: 'SH001' })
			);
		});

		it('useShiftReconciliation calls workflow with authenticated context and respects conditional enabled', async () => {
			useShiftReconciliation(() => '');
			expect(tracker.lastCreatedQuery?.enabled).toBe(false);

			mockWorkflowCalls.calculateShiftReconciliation.mockResolvedValueOnce({
				ticket: { _id: 'tkt_rec' },
				summaries: []
			});

			useShiftReconciliation(() => 'tkt_rec');
			expect(tracker.lastCreatedQuery?.enabled).toBe(true);
			expect(tracker.lastCreatedQuery?.queryKey).toEqual(
				distributionKeys.shiftReconciliation('SH001', 'tkt_rec')
			);

			await tracker.lastCreatedQuery?.queryFn();
			expect(mockWorkflowCalls.calculateShiftReconciliation).toHaveBeenCalledWith(
				'tkt_rec',
				expect.objectContaining({
					shelterCode: 'SH001',
					createdBy: 'staff_alice'
				})
			);
		});
	});

	describe('4. Mutation Caller Wrappers & Authoritative Invalidation (All 19 Workflows)', () => {
		const ticketsList = ['distribution', 'SH001', 'tickets'];
		const stableAmendmentId = createStableOperationId();
		const stableOpUlid = createStableOperationId();

		type MutationCase = {
			name: string;
			hook: () => unknown;
			workflow: keyof typeof mockWorkflowCalls;
			/** Variables handed to `mutationFn`. */
			variables: unknown;
			/** Positional workflow args that precede the author context. */
			args: unknown[];
			/** Query keys that `onSuccess` must invalidate (each at least once). */
			invalidates: unknown[];
		};

		const createInput = {
			requisition_type: 'food' as const,
			destination_location: 'ZONE_A',
			meal: 'lunch' as const,
			items: [{ item_id: 'item_meal', requested_qty: '50' }]
		};
		const allocations = [{ item_id: 'item_1', allocated_qty: '50' }];
		const dispatchOptions = { driver_name: 'Driver Bob', license_plate: '1กข1234' };
		const amendInput = { amendmentId: stableAmendmentId, item_id: 'item_water', added_qty: '20' };
		const foodInput = {
			item_id: 'meal_box',
			qty: '2',
			recipient_type: 'individual' as const,
			recipient_id: 'person_123'
		};
		const suppliesInput = {
			item_id: 'blanket',
			qty: '1',
			recipient_type: 'individual' as const,
			recipient_id: 'person_456'
		};
		const returnInput = { qty_returned: '1', condition_on_return: 'READY' as const };
		const clearInput = { clear_reason: 'lost' as const, notes: 'Missing in field' };
		const poolInput = {
			operationUlid: stableOpUlid,
			item_id: 'tent_item',
			total_received_qty: '10'
		};
		const bulkClearInput = {
			operationUlid: stableOpUlid,
			logId: 'log_claim',
			poolId: 'pool_claim'
		};
		const v3OpenInput = { name: 'Pool A' };
		const v3Patch = { name: 'Pool B', notes: null };
		const v3ReceiveInput = { items: [{ item_id: 'item:cot', received_qty: '2' }] };
		const v3AddInput = {
			pool_id: 'bulk_return_pool:X',
			returner: { type: 'evacuee' as const, id: 'evacuee:e1' },
			items: [{ item_id: 'item_1', qty: '2', operationUlid: stableOpUlid }]
		};
		const v3MoveInput = { entry_id: 'bulk_return_entry:E', to_pool_id: 'bulk_return_pool:Y' };
		const v3VoidInput = { entry_id: 'bulk_return_entry:E' };
		const closeOptions = { returned_quantities: { item_1: '5' } };
		const receiveOptions = { verified_returned_quantities: { item_1: '5' } };

		const cases: MutationCase[] = [
			{
				name: 'useCreateRequisitionTicket (Workflow 1): forwards input + ctx and invalidates tickets',
				hook: useCreateRequisitionTicket,
				workflow: 'createRequisitionTicket',
				variables: { input: createInput },
				args: [createInput],
				invalidates: [ticketsList]
			},
			{
				name: 'useAllocateTicketItems (Workflow 2): invalidates detail and ticket list',
				hook: useAllocateTicketItems,
				workflow: 'allocateTicketItems',
				variables: { ticketId: 'tkt_alloc', allocations },
				args: ['tkt_alloc', allocations],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_alloc'), ticketsList]
			},
			{
				name: 'useApproveTicketForDispatch (Workflow 3): invalidates detail and ticket list',
				hook: useApproveTicketForDispatch,
				workflow: 'approveTicketForDispatch',
				variables: { ticketId: 'tkt_appr' },
				args: ['tkt_appr'],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_appr')]
			},
			{
				name: 'useCancelTicket (Workflow 4): invalidates detail and ticket list',
				hook: useCancelTicket,
				workflow: 'cancelTicket',
				variables: { ticketId: 'tkt_cancel', reason: 'Emergency stop' },
				args: ['tkt_cancel', 'Emergency stop'],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_cancel')]
			},
			{
				name: 'useDispatchTicket (Workflow 5): invalidates ticket and operations stock ledgers',
				hook: useDispatchTicket,
				workflow: 'dispatchTicket',
				variables: { ticketId: 'tkt_disp', options: dispatchOptions },
				args: ['tkt_disp', dispatchOptions],
				invalidates: [
					distributionKeys.ticket('SH001', 'tkt_disp'),
					operationsKeys.stockLedgers(),
					operationsKeys.balance()
				]
			},
			{
				name: 'useReceiveTicketAtDistributionPoint (Workflow 6): invalidates ticket and list',
				hook: useReceiveTicketAtDistributionPoint,
				workflow: 'receiveTicketAtDistributionPoint',
				variables: { ticketId: 'tkt_rcv' },
				args: ['tkt_rcv'],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_rcv')]
			},
			{
				name: 'useAmendActiveTicket (Workflow 7): preserves caller-supplied amendmentId across invocations',
				hook: useAmendActiveTicket,
				workflow: 'amendActiveTicket',
				variables: { ticketId: 'tkt_amend', input: amendInput },
				args: [
					'tkt_amend',
					expect.objectContaining({ amendmentId: stableAmendmentId, added_qty: '20' })
				],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_amend'), operationsKeys.stockLedgers()]
			},
			{
				name: 'useRecordFoodDistribution (Workflow 8): invalidates logs, ticket, and reconciliation',
				hook: useRecordFoodDistribution,
				workflow: 'recordFoodDistribution',
				variables: { ticketId: 'tkt_food', input: foodInput },
				args: ['tkt_food', foodInput],
				invalidates: [
					['distribution', 'SH001', 'logs'],
					distributionKeys.ticket('SH001', 'tkt_food'),
					distributionKeys.shiftReconciliation('SH001', 'tkt_food')
				]
			},
			{
				name: 'useRecordSuppliesDistribution (Workflow 9): invalidates logs, ticket, and reconciliation',
				hook: useRecordSuppliesDistribution,
				workflow: 'recordSuppliesDistribution',
				variables: { ticketId: 'tkt_supplies', input: suppliesInput },
				args: ['tkt_supplies', suppliesInput],
				invalidates: [['distribution', 'SH001', 'logs']]
			},
			{
				name: 'useVoidDistributionLog (Workflow 10): invalidates log and ticket capacity',
				hook: useVoidDistributionLog,
				workflow: 'voidDistributionLog',
				variables: { logId: 'log_void', reason: 'Incorrect recipient', ticketId: 'tkt_target' },
				args: ['log_void', 'Incorrect recipient'],
				invalidates: [
					distributionKeys.log('SH001', 'log_void'),
					distributionKeys.ticket('SH001', 'tkt_target')
				]
			},
			{
				name: 'useReturnLoanAtCounter (Workflow 11): invalidates log, logs, and stock ledger',
				hook: useReturnLoanAtCounter,
				workflow: 'returnLoanAtCounter',
				variables: { logId: 'log_loan', input: returnInput },
				args: ['log_loan', returnInput],
				invalidates: [
					distributionKeys.log('SH001', 'log_loan'),
					operationsKeys.stockLedgers(),
					distributionKeys.returnOperationState('SH001', 'log_loan')
				]
			},
			{
				name: 'useClearLoanNonPhysical (Workflow 12): invalidates log and logs without stock write',
				hook: useClearLoanNonPhysical,
				workflow: 'clearLoanNonPhysical',
				variables: { logId: 'log_lost', input: clearInput },
				args: ['log_lost', clearInput],
				invalidates: [
					distributionKeys.log('SH001', 'log_lost'),
					distributionKeys.returnOperationState('SH001', 'log_lost')
				]
			},
			{
				name: 'useCreateBulkReturnPool (Workflow 13): forwards stable operationUlid and invalidates pools and stock',
				hook: useCreateBulkReturnPool,
				workflow: 'createBulkReturnPool',
				variables: { input: poolInput },
				args: [poolInput],
				invalidates: [['distribution', 'SH001', 'bulk_pools'], operationsKeys.stockLedgers()]
			},
			{
				name: 'useClearLoanViaBulkPool (Workflow 14): forwards stable operationUlid and invalidates pool, claim, log',
				hook: useClearLoanViaBulkPool,
				workflow: 'clearLoanViaBulkPool',
				variables: { input: bulkClearInput },
				args: [bulkClearInput],
				invalidates: [
					distributionKeys.bulkPool('SH001', 'pool_claim'),
					distributionKeys.log('SH001', 'log_claim'),
					['distribution', 'SH001', 'bulk_claims']
				]
			},
			{
				name: 'useCloseShift (Workflow 16): invalidates ticket, list, and reconciliation',
				hook: useCloseShift,
				workflow: 'closeShift',
				variables: { ticketId: 'tkt_close', options: closeOptions },
				args: ['tkt_close', closeOptions],
				invalidates: [
					distributionKeys.ticket('SH001', 'tkt_close'),
					distributionKeys.shiftReconciliation('SH001', 'tkt_close')
				]
			},
			{
				name: 'useSubmitReturnsToWarehouse (Workflow 17): invalidates ticket and list',
				hook: useSubmitReturnsToWarehouse,
				workflow: 'submitReturnsToWarehouse',
				variables: { ticketId: 'tkt_sub_ret' },
				args: ['tkt_sub_ret'],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_sub_ret')]
			},
			{
				name: 'useReceiveWarehouseReturns (Workflow 18): invalidates ticket and operations stock',
				hook: useReceiveWarehouseReturns,
				workflow: 'receiveWarehouseReturns',
				variables: { ticketId: 'tkt_rcv_ret', options: receiveOptions },
				args: ['tkt_rcv_ret', receiveOptions],
				invalidates: [
					distributionKeys.ticket('SH001', 'tkt_rcv_ret'),
					operationsKeys.stockLedgers()
				]
			},
			{
				name: 'useCompleteTicket (Workflow 19): invalidates ticket and list',
				hook: useCompleteTicket,
				workflow: 'completeTicket',
				variables: { ticketId: 'tkt_done' },
				args: ['tkt_done'],
				invalidates: [distributionKeys.ticket('SH001', 'tkt_done')]
			},
			{
				name: 'useOpenBulkReturnPool (v3): forwards input + caller operationUlid and invalidates v3 pools',
				hook: useOpenBulkReturnPool,
				workflow: 'openBulkReturnPool',
				variables: { input: v3OpenInput, operationUlid: stableOpUlid },
				args: [v3OpenInput, stableOpUlid],
				invalidates: [distributionKeys.bulkPoolsV3All('SH001')]
			},
			{
				name: 'useUpdateBulkReturnPoolHeader (v3): forwards poolId + patch and invalidates v3 pools',
				hook: useUpdateBulkReturnPoolHeader,
				workflow: 'updateBulkReturnPoolHeader',
				variables: { poolId: 'bulk_return_pool:X', patch: v3Patch },
				args: ['bulk_return_pool:X', v3Patch],
				invalidates: [distributionKeys.bulkPoolsV3All('SH001')]
			},
			{
				name: 'useAddBulkReturnEntries (v3): invalidates v3 pools, logs and outstanding loans',
				hook: useAddBulkReturnEntries,
				workflow: 'addBulkReturnEntries',
				variables: { input: v3AddInput },
				args: [v3AddInput],
				invalidates: [
					distributionKeys.bulkPoolsV3All('SH001'),
					['distribution', 'SH001', 'logs'],
					distributionKeys.returnerOutstandingLoansAll('SH001')
				]
			},
			{
				name: 'useMoveBulkReturnEntry (v3): invalidates v3 pools',
				hook: useMoveBulkReturnEntry,
				workflow: 'moveBulkReturnEntry',
				variables: { input: v3MoveInput },
				args: [v3MoveInput],
				invalidates: [distributionKeys.bulkPoolsV3All('SH001')]
			},
			{
				name: 'useVoidBulkReturnEntry (v3): invalidates v3 pools, logs and outstanding loans',
				hook: useVoidBulkReturnEntry,
				workflow: 'voidBulkReturnEntry',
				variables: { input: v3VoidInput },
				args: [v3VoidInput],
				invalidates: [
					distributionKeys.bulkPoolsV3All('SH001'),
					['distribution', 'SH001', 'logs'],
					distributionKeys.returnerOutstandingLoansAll('SH001')
				]
			},
			{
				name: 'useCancelBulkReturnPool (v3): forwards poolId + caller operationUlid and invalidates v3 pools',
				hook: useCancelBulkReturnPool,
				workflow: 'cancelBulkReturnPool',
				variables: { poolId: 'bulk_return_pool:X', operationUlid: stableOpUlid },
				args: ['bulk_return_pool:X', stableOpUlid],
				invalidates: [distributionKeys.bulkPoolsV3All('SH001')]
			},
			{
				name: 'useSubmitBulkReturnPool (v3): forwards poolId + caller operationUlid and invalidates v3 pools',
				hook: useSubmitBulkReturnPool,
				workflow: 'submitBulkReturnPool',
				variables: { poolId: 'bulk_return_pool:X', operationUlid: stableOpUlid },
				args: ['bulk_return_pool:X', stableOpUlid],
				invalidates: [distributionKeys.bulkPoolsV3All('SH001')]
			},
			{
				name: 'useReceiveBulkReturnPool (v3): forwards poolId + input + operationUlid, invalidates v3 pools and operations stock',
				hook: useReceiveBulkReturnPool,
				workflow: 'receiveBulkReturnPool',
				variables: {
					poolId: 'bulk_return_pool:X',
					input: v3ReceiveInput,
					operationUlid: stableOpUlid
				},
				args: ['bulk_return_pool:X', v3ReceiveInput, stableOpUlid],
				invalidates: [
					distributionKeys.bulkPoolsV3All('SH001'),
					operationsKeys.stockLedgers(),
					operationsKeys.ledger(),
					operationsKeys.balance()
				]
			}
		];

		it.each(cases)('$name', async ({ hook, workflow, variables, args, invalidates }) => {
			mockWorkflowCalls[workflow].mockResolvedValueOnce({});
			hook();
			expect(tracker.lastCreatedMutation?.retry).toBe(false);

			await tracker.lastCreatedMutation?.mutationFn(variables);
			expect(mockWorkflowCalls[workflow]).toHaveBeenCalledWith(
				...args,
				expect.objectContaining({ createdBy: 'staff_alice', shelterCode: 'SH001' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, variables, undefined);
			for (const queryKey of invalidates) {
				expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey });
			}
		});
	});

	describe('5. Live Query Changes Invalidation', () => {
		it('startDistributionLiveQuery maps distribution doc types to target queries', () => {
			startDistributionLiveQuery(mockQueryClient as never);
			expect(subscribeCalls).toHaveLength(1);
			const { keysForType } = subscribeCalls[0]!;

			expect(keysForType('requisition_ticket')).toEqual([
				['distribution', 'SH001', 'tickets'],
				['distribution', 'SH001', 'ticket']
			]);

			expect(keysForType('distribution_log')).toEqual([
				['distribution', 'SH001', 'logs'],
				['distribution', 'SH001', 'log'],
				['distribution', 'SH001', 'shift_reconciliation'],
				['distribution', 'SH001', 'returner_outstanding_loans'],
				['distribution', 'SH001', 'bulk_pools_v3', 'closed_loan_refs'],
				['distribution', 'SH001', 'bulk_pools_v3', 'applied_loan_refs']
			]);

			expect(keysForType('bulk_return_pool')).toEqual([
				['distribution', 'SH001', 'bulk_pools'],
				['distribution', 'SH001', 'bulk_pool'],
				['distribution', 'SH001', 'bulk_pools_v3']
			]);

			for (const type of [
				'bulk_return_entry',
				'bulk_return_entry_move',
				'bulk_return_entry_void'
			]) {
				expect(keysForType(type)).toEqual([['distribution', 'SH001', 'bulk_pools_v3']]);
			}

			expect(keysForType('bulk_return_claim')).toEqual([
				['distribution', 'SH001', 'bulk_claims'],
				['distribution', 'SH001', 'bulk_claim']
			]);

			expect(keysForType('loan_return_reservation')).toEqual([
				['distribution', 'SH001', 'return_operation_state']
			]);

			expect(keysForType('unrelated_doc')).toEqual([]);
		});
	});

	describe('6. Cache Invalidation Helpers', () => {
		const qc = () => mockQueryClient as never;
		const cases: Array<{
			name: string;
			run: () => void;
			invalidates: unknown[];
		}> = [
			{
				name: 'invalidateTicketCollection invalidates shelter ticket list queries',
				run: () => invalidateTicketCollection(qc(), 'SH001'),
				invalidates: [['distribution', 'SH001', 'tickets']]
			},
			{
				name: 'invalidateTicket invalidates specific ticket query',
				run: () => invalidateTicket(qc(), 'SH001', 'tkt_01'),
				invalidates: [['distribution', 'SH001', 'ticket', 'tkt_01']]
			},
			{
				name: 'invalidateTicketWithCollection invalidates both ticket and collection',
				run: () => invalidateTicketWithCollection(qc(), 'SH001', 'tkt_01'),
				invalidates: [
					['distribution', 'SH001', 'ticket', 'tkt_01'],
					['distribution', 'SH001', 'tickets']
				]
			},
			{
				name: 'invalidateDistributionLogs invalidates log collections and specific log when provided',
				run: () => invalidateDistributionLogs(qc(), 'SH001', 'log_01'),
				invalidates: [
					['distribution', 'SH001', 'log', 'log_01'],
					['distribution', 'SH001', 'logs']
				]
			},
			{
				name: 'invalidateShiftReconciliation invalidates shift reconciliation query',
				run: () => invalidateShiftReconciliation(qc(), 'SH001', 'tkt_01'),
				invalidates: [['distribution', 'SH001', 'shift_reconciliation', 'tkt_01']]
			},
			{
				name: 'invalidateBulkPools invalidates pool collections and specific pool when provided',
				run: () => invalidateBulkPools(qc(), 'SH001', 'pool_01'),
				invalidates: [
					['distribution', 'SH001', 'bulk_pool', 'pool_01'],
					['distribution', 'SH001', 'bulk_pools']
				]
			},
			{
				name: 'invalidateBulkClaims invalidates claim collections and specific claim when provided',
				run: () => invalidateBulkClaims(qc(), 'SH001', 'claim_01'),
				invalidates: [
					['distribution', 'SH001', 'bulk_claim', 'claim_01'],
					['distribution', 'SH001', 'bulk_claims']
				]
			},
			{
				name: 'invalidateInventoryQueries invalidates stock ledgers, ledger, and balance',
				run: () => invalidateInventoryQueries(qc()),
				invalidates: [
					operationsKeys.stockLedgers(),
					operationsKeys.ledger(),
					operationsKeys.balance()
				]
			}
		];

		it.each(cases)('$name', ({ run, invalidates }) => {
			run();
			for (const queryKey of invalidates) {
				expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey });
			}
		});
	});
});
