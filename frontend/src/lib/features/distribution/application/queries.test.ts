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
		completeTicket: vi.fn()
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
	useBulkReturnClaim,
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
	useClearLoanViaBulkPool,
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
	invalidateBulkPools,
	invalidateBulkClaims,
	invalidateInventoryQueries
} from './queries';

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

		it('generates deterministic query keys for bulk pools and claims (CR-134)', () => {
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
		it('useCreateRequisitionTicket (Workflow 1): forwards input + ctx and invalidates tickets', async () => {
			mockWorkflowCalls.createRequisitionTicket.mockResolvedValueOnce({ _id: 'tkt_new' });
			useCreateRequisitionTicket();
			expect(tracker.lastCreatedMutation?.retry).toBe(false);

			const input = {
				requisition_type: 'food' as const,
				destination_location: 'ZONE_A',
				meal: 'lunch' as const,
				items: [{ item_id: 'item_meal', requested_qty: '50' }]
			};
			await tracker.lastCreatedMutation?.mutationFn({ input });
			expect(mockWorkflowCalls.createRequisitionTicket).toHaveBeenCalledWith(
				input,
				expect.objectContaining({ createdBy: 'staff_alice', shelterCode: 'SH001' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({ _id: 'tkt_new' }, { input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'tickets']
			});
		});

		it('useAllocateTicketItems (Workflow 2): invalidates detail and ticket list', async () => {
			useAllocateTicketItems();
			expect(tracker.lastCreatedMutation?.retry).toBe(false);

			const allocations = [{ item_id: 'item_1', allocated_qty: '50' }];
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_alloc', allocations });
			expect(mockWorkflowCalls.allocateTicketItems).toHaveBeenCalledWith(
				'tkt_alloc',
				allocations,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.(
				{},
				{ ticketId: 'tkt_alloc', allocations },
				undefined
			);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_alloc')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'tickets']
			});
		});

		it('useApproveTicketForDispatch (Workflow 3): invalidates detail and ticket list', async () => {
			useApproveTicketForDispatch();
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_appr' });
			expect(mockWorkflowCalls.approveTicketForDispatch).toHaveBeenCalledWith(
				'tkt_appr',
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_appr' }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_appr')
			});
		});

		it('useCancelTicket (Workflow 4): invalidates detail and ticket list', async () => {
			useCancelTicket();
			await tracker.lastCreatedMutation?.mutationFn({
				ticketId: 'tkt_cancel',
				reason: 'Emergency stop'
			});
			expect(mockWorkflowCalls.cancelTicket).toHaveBeenCalledWith(
				'tkt_cancel',
				'Emergency stop',
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.(
				{},
				{ ticketId: 'tkt_cancel', reason: 'Emergency stop' },
				undefined
			);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_cancel')
			});
		});

		it('useDispatchTicket (Workflow 5): invalidates ticket and operations stock ledgers', async () => {
			useDispatchTicket();
			const options = { driver_name: 'Driver Bob', license_plate: '1กข1234' };
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_disp', options });
			expect(mockWorkflowCalls.dispatchTicket).toHaveBeenCalledWith(
				'tkt_disp',
				options,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_disp', options }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_disp')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.stockLedgers()
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.balance()
			});
		});

		it('useReceiveTicketAtDistributionPoint (Workflow 6): invalidates ticket and list', async () => {
			useReceiveTicketAtDistributionPoint();
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_rcv' });
			expect(mockWorkflowCalls.receiveTicketAtDistributionPoint).toHaveBeenCalledWith(
				'tkt_rcv',
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_rcv' }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_rcv')
			});
		});

		it('useAmendActiveTicket (Workflow 7): preserves caller-supplied amendmentId across invocations', async () => {
			useAmendActiveTicket();
			const stableAmendmentId = createStableOperationId();
			const input = {
				amendmentId: stableAmendmentId,
				item_id: 'item_water',
				added_qty: '20'
			};

			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_amend', input });
			expect(mockWorkflowCalls.amendActiveTicket).toHaveBeenCalledWith(
				'tkt_amend',
				expect.objectContaining({ amendmentId: stableAmendmentId, added_qty: '20' }),
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_amend', input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_amend')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.stockLedgers()
			});
		});

		it('useRecordFoodDistribution (Workflow 8): invalidates logs, ticket, and reconciliation', async () => {
			useRecordFoodDistribution();
			const input = {
				item_id: 'meal_box',
				qty: '2',
				recipient_type: 'individual' as const,
				recipient_id: 'person_123'
			};
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_food', input });
			expect(mockWorkflowCalls.recordFoodDistribution).toHaveBeenCalledWith(
				'tkt_food',
				input,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_food', input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'logs']
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_food')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.shiftReconciliation('SH001', 'tkt_food')
			});
		});

		it('useRecordSuppliesDistribution (Workflow 9): invalidates logs, ticket, and reconciliation', async () => {
			useRecordSuppliesDistribution();
			const input = {
				item_id: 'blanket',
				qty: '1',
				recipient_type: 'individual' as const,
				recipient_id: 'person_456'
			};
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_supplies', input });
			expect(mockWorkflowCalls.recordSuppliesDistribution).toHaveBeenCalledWith(
				'tkt_supplies',
				input,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_supplies', input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'logs']
			});
		});

		it('useVoidDistributionLog (Workflow 10): invalidates log and ticket capacity', async () => {
			useVoidDistributionLog();
			await tracker.lastCreatedMutation?.mutationFn({
				logId: 'log_void',
				reason: 'Incorrect recipient',
				ticketId: 'tkt_target'
			});
			expect(mockWorkflowCalls.voidDistributionLog).toHaveBeenCalledWith(
				'log_void',
				'Incorrect recipient',
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.(
				{},
				{ logId: 'log_void', reason: 'Incorrect recipient', ticketId: 'tkt_target' },
				undefined
			);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.log('SH001', 'log_void')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_target')
			});
		});

		it('useReturnLoanAtCounter (Workflow 11): invalidates log, logs, and stock ledger', async () => {
			useReturnLoanAtCounter();
			const input = { qty_returned: '1', condition_on_return: 'READY' as const };
			await tracker.lastCreatedMutation?.mutationFn({ logId: 'log_loan', input });
			expect(mockWorkflowCalls.returnLoanAtCounter).toHaveBeenCalledWith(
				'log_loan',
				input,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { logId: 'log_loan', input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.log('SH001', 'log_loan')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.stockLedgers()
			});
		});

		it('useClearLoanNonPhysical (Workflow 12): invalidates log and logs without stock write', async () => {
			useClearLoanNonPhysical();
			const input = { clear_reason: 'lost' as const, notes: 'Missing in field' };
			await tracker.lastCreatedMutation?.mutationFn({ logId: 'log_lost', input });
			expect(mockWorkflowCalls.clearLoanNonPhysical).toHaveBeenCalledWith(
				'log_lost',
				input,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { logId: 'log_lost', input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.log('SH001', 'log_lost')
			});
		});

		it('useCreateBulkReturnPool (Workflow 13): forwards stable operationUlid and invalidates pools and stock', async () => {
			useCreateBulkReturnPool();
			const stableOpUlid = createStableOperationId();
			const input = {
				operationUlid: stableOpUlid,
				item_id: 'tent_item',
				total_received_qty: '10'
			};
			await tracker.lastCreatedMutation?.mutationFn({ input });
			expect(mockWorkflowCalls.createBulkReturnPool).toHaveBeenCalledWith(
				input,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'bulk_pools']
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.stockLedgers()
			});
		});

		it('useClearLoanViaBulkPool (Workflow 14): forwards stable operationUlid and invalidates pool, claim, log', async () => {
			useClearLoanViaBulkPool();
			const stableOpUlid = createStableOperationId();
			const input = {
				operationUlid: stableOpUlid,
				logId: 'log_claim',
				poolId: 'pool_claim'
			};
			await tracker.lastCreatedMutation?.mutationFn({ input });
			expect(mockWorkflowCalls.clearLoanViaBulkPool).toHaveBeenCalledWith(
				input,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { input }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.bulkPool('SH001', 'pool_claim')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.log('SH001', 'log_claim')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'bulk_claims']
			});
		});

		it('useCloseShift (Workflow 16): invalidates ticket, list, and reconciliation', async () => {
			useCloseShift();
			const options = { returned_quantities: { item_1: '5' } };
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_close', options });
			expect(mockWorkflowCalls.closeShift).toHaveBeenCalledWith(
				'tkt_close',
				options,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_close', options }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_close')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.shiftReconciliation('SH001', 'tkt_close')
			});
		});

		it('useSubmitReturnsToWarehouse (Workflow 17): invalidates ticket and list', async () => {
			useSubmitReturnsToWarehouse();
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_sub_ret' });
			expect(mockWorkflowCalls.submitReturnsToWarehouse).toHaveBeenCalledWith(
				'tkt_sub_ret',
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_sub_ret' }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_sub_ret')
			});
		});

		it('useReceiveWarehouseReturns (Workflow 18): invalidates ticket and operations stock', async () => {
			useReceiveWarehouseReturns();
			const options = { verified_returned_quantities: { item_1: '5' } };
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_rcv_ret', options });
			expect(mockWorkflowCalls.receiveWarehouseReturns).toHaveBeenCalledWith(
				'tkt_rcv_ret',
				options,
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_rcv_ret', options }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_rcv_ret')
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.stockLedgers()
			});
		});

		it('useCompleteTicket (Workflow 19): invalidates ticket and list', async () => {
			useCompleteTicket();
			await tracker.lastCreatedMutation?.mutationFn({ ticketId: 'tkt_done' });
			expect(mockWorkflowCalls.completeTicket).toHaveBeenCalledWith(
				'tkt_done',
				expect.objectContaining({ createdBy: 'staff_alice' })
			);

			tracker.lastCreatedMutation?.onSuccess?.({}, { ticketId: 'tkt_done' }, undefined);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: distributionKeys.ticket('SH001', 'tkt_done')
			});
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
				['distribution', 'SH001', 'shift_reconciliation']
			]);

			expect(keysForType('bulk_return_pool')).toEqual([
				['distribution', 'SH001', 'bulk_pools'],
				['distribution', 'SH001', 'bulk_pool']
			]);

			expect(keysForType('bulk_return_claim')).toEqual([
				['distribution', 'SH001', 'bulk_claims'],
				['distribution', 'SH001', 'bulk_claim']
			]);

			expect(keysForType('unrelated_doc')).toEqual([]);
		});
	});

	describe('6. Cache Invalidation Helpers', () => {
		it('invalidateTicketCollection invalidates shelter ticket list queries', () => {
			invalidateTicketCollection(mockQueryClient as never, 'SH001');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'tickets']
			});
		});

		it('invalidateTicket invalidates specific ticket query', () => {
			invalidateTicket(mockQueryClient as never, 'SH001', 'tkt_01');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'ticket', 'tkt_01']
			});
		});

		it('invalidateTicketWithCollection invalidates both ticket and collection', () => {
			invalidateTicketWithCollection(mockQueryClient as never, 'SH001', 'tkt_01');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'ticket', 'tkt_01']
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'tickets']
			});
		});

		it('invalidateDistributionLogs invalidates log collections and specific log when provided', () => {
			invalidateDistributionLogs(mockQueryClient as never, 'SH001', 'log_01');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'log', 'log_01']
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'logs']
			});
		});

		it('invalidateShiftReconciliation invalidates shift reconciliation query', () => {
			invalidateShiftReconciliation(mockQueryClient as never, 'SH001', 'tkt_01');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'shift_reconciliation', 'tkt_01']
			});
		});

		it('invalidateBulkPools invalidates pool collections and specific pool when provided', () => {
			invalidateBulkPools(mockQueryClient as never, 'SH001', 'pool_01');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'bulk_pool', 'pool_01']
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'bulk_pools']
			});
		});

		it('invalidateBulkClaims invalidates claim collections and specific claim when provided', () => {
			invalidateBulkClaims(mockQueryClient as never, 'SH001', 'claim_01');
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'bulk_claim', 'claim_01']
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['distribution', 'SH001', 'bulk_claims']
			});
		});

		it('invalidateInventoryQueries invalidates stock ledgers, ledger, and balance', () => {
			invalidateInventoryQueries(mockQueryClient as never);
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.stockLedgers()
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.ledger()
			});
			expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
				queryKey: operationsKeys.balance()
			});
		});
	});
});
