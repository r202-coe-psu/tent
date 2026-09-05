import { getContext, setContext } from 'svelte';
import {
	createMockCatalogItems,
	createMockReadyStockItems,
	createMockRequisitions,
	createMockRecipients,
	createMockDistributionLogs
} from '../data/item-distribution.mock-data';
import {
	formatDistributionTimestamp,
	type CatalogItem,
	type ReadyStockItem,
	type RequisitionTicket,
	type RequisitionItem,
	type TargetGroup,
	type DistributionMode,
	type RequisitionStatus,
	type Recipient,
	type DistributionLog
} from '../domain/item-distribution';

class DistributionStore {
	// Navigation & UI tabs
	activeTab = $state<'stock' | 'requisitions'>('stock');

	// Search & Filters
	searchQuery = $state<string>('');
	statusFilter = $state<string>('all');
	modeFilter = $state<string>('all');
	targetGroupFilter = $state<string>('all');
	dateRangeFilter = $state<string>('all');

	// Data Collections
	catalogItems = $state.raw<CatalogItem[]>(createMockCatalogItems());
	readyStockItems = $state<ReadyStockItem[]>(createMockReadyStockItems());
	requisitions = $state<RequisitionTicket[]>(createMockRequisitions());
	recipients = $state.raw<Recipient[]>(createMockRecipients());
	distributionLogs = $state<DistributionLog[]>(createMockDistributionLogs());

	// Dialog states
	createModalOpen = $state<boolean>(false);
	distributeModalOpen = $state<boolean>(false);
	returnModalOpen = $state<boolean>(false);
	detailModalOpen = $state<boolean>(false);

	selectedStockItem = $state<ReadyStockItem | null>(null);
	selectedTicket = $state<RequisitionTicket | null>(null);

	// Derived values
	readyStockTotalTypesCount = $derived.by(() => {
		return this.readyStockItems.length;
	});

	activeRequisitionsCount = $derived.by(() => {
		return this.requisitions.filter(
			(r) => r.status === 'pending_approval' || r.status === 'distributing'
		).length;
	});

	pendingApprovalCount = $derived.by(() => {
		return this.requisitions.filter((r) => r.status === 'pending_approval').length;
	});

	completedRequisitionsCount = $derived.by(() => {
		return this.requisitions.filter((r) => r.status === 'completed').length;
	});

	filteredRequisitions = $derived.by(() => {
		const q = this.searchQuery.trim().toLowerCase();
		return this.requisitions.filter((t) => {
			// Status filter
			if (this.statusFilter !== 'all') {
				if (
					this.statusFilter === 'active' &&
					!(t.status === 'pending_approval' || t.status === 'distributing')
				) {
					return false;
				}
				if (this.statusFilter === 'pending_approval' && t.status !== 'pending_approval') {
					return false;
				}
				if (this.statusFilter === 'completed' && t.status !== 'completed') {
					return false;
				}
				if (this.statusFilter === 'returned' && t.status !== 'partially_returned') {
					return false;
				}
			}

			// Mode filter
			if (this.modeFilter !== 'all' && t.distribution_mode !== this.modeFilter) {
				return false;
			}

			// Search query
			if (q) {
				const matchCode = t.ticket_code.toLowerCase().includes(q);
				const matchReason = t.reason.toLowerCase().includes(q);
				const matchRequester = t.requested_by.toLowerCase().includes(q);
				const matchItems = t.items.some((i) => i.name.toLowerCase().includes(q));
				if (!matchCode && !matchReason && !matchRequester && !matchItems) {
					return false;
				}
			}

			return true;
		});
	});

	filteredStock = $derived.by(() => {
		const q = this.searchQuery.trim().toLowerCase();
		return this.readyStockItems.filter((item) => {
			if (this.modeFilter !== 'all' && item.mode !== this.modeFilter) {
				return false;
			}
			if (q) {
				const matchName = item.name.toLowerCase().includes(q);
				const matchCategory = item.category.toLowerCase().includes(q);
				const matchLocation = item.location.toLowerCase().includes(q);
				if (!matchName && !matchCategory && !matchLocation) {
					return false;
				}
			}
			return true;
		});
	});

	// Actions
	openCreateModal() {
		this.createModalOpen = true;
	}

	closeCreateModal() {
		this.createModalOpen = false;
	}

	openDistributeModal(item: ReadyStockItem) {
		this.selectedStockItem = item;
		this.distributeModalOpen = true;
	}

	closeDistributeModal() {
		this.selectedStockItem = null;
		this.distributeModalOpen = false;
	}

	openReturnModal(ticket: RequisitionTicket) {
		this.selectedTicket = ticket;
		this.returnModalOpen = true;
	}

	closeReturnModal() {
		this.selectedTicket = null;
		this.returnModalOpen = false;
	}

	openDetailModal(ticket: RequisitionTicket) {
		this.selectedTicket = ticket;
		this.detailModalOpen = true;
	}

	closeDetailModal() {
		this.selectedTicket = null;
		this.detailModalOpen = false;
	}

	createRequisition(payload: {
		hubId: string;
		hubName: string;
		targetGroup: TargetGroup;
		distributionMode: DistributionMode;
		items: { catalogItemId: string; quantity: number }[];
		reason: string;
	}) {
		const randomNum = Math.floor(10000 + Math.random() * 90000);
		const ticket_code = `TKT-DIST-${randomNum}`;

		const reqItems: RequisitionItem[] = payload.items.map((i) => {
			const catalogItem = this.catalogItems.find((c) => c.id === i.catalogItemId);
			return {
				item_id: i.catalogItemId,
				name: catalogItem ? catalogItem.name : 'สินค้าทั่วไป',
				quantity: i.quantity,
				unit: catalogItem ? catalogItem.unit : 'ชิ้น',
				distributed_qty: 0,
				damaged_qty: 0,
				returned_qty: 0
			};
		});

		const totalRequested = reqItems.reduce((acc, curr) => acc + curr.quantity, 0);

		const formattedDate = formatDistributionTimestamp();

		const newTicket: RequisitionTicket = {
			ticket_code,
			hub_id: payload.hubId,
			hub_name: payload.hubName,
			target_group: payload.targetGroup,
			distribution_mode: payload.distributionMode,
			items: reqItems,
			total_requested: totalRequested,
			total_distributed: 0,
			total_damaged: 0,
			total_returned: 0,
			status: 'pending_approval',
			created_at: formattedDate,
			reason: payload.reason || 'ขอเบิกพัสดุช่วยเหลือ',
			requested_by: 'เจ้าหน้าที่ส่วนหน้า (ระบบ)'
		};

		this.requisitions = [newTicket, ...this.requisitions];
		this.closeCreateModal();
		return newTicket;
	}

	distributeItemToRecipient(stockId: string, recipientId: string, qty: number) {
		const stockIndex = this.readyStockItems.findIndex((s) => s.id === stockId);
		if (stockIndex === -1) return;

		const stockItem = this.readyStockItems[stockIndex];
		const recipient = this.recipients.find((r) => r.id === recipientId);

		const actualQty = Math.min(qty, stockItem.availableQuantity);

		this.readyStockItems[stockIndex] = {
			...stockItem,
			availableQuantity: stockItem.availableQuantity - actualQty,
			distributedQuantity: stockItem.distributedQuantity + actualQty
		};

		const formattedDate = formatDistributionTimestamp();

		const newLog: DistributionLog = {
			id: `LOG-${Date.now()}`,
			ticket_code: 'ONSITE-DIRECT',
			recipient_name: recipient ? recipient.name : 'ผู้พักพิง/เจ้าหน้าที่',
			item_name: stockItem.name,
			quantity: actualQty,
			unit: stockItem.unit,
			timestamp: formattedDate,
			status: stockItem.mode === 'borrow_return' ? 'borrowed' : 'completed'
		};

		this.distributionLogs = [newLog, ...this.distributionLogs];
		this.closeDistributeModal();
	}

	returnBorrowedItem(ticketCode: string, itemId: string, returnedQty: number, damagedQty: number) {
		const ticketIndex = this.requisitions.findIndex((r) => r.ticket_code === ticketCode);
		if (ticketIndex === -1) return;

		const ticket = this.requisitions[ticketIndex];
		const itemIndex = ticket.items.findIndex((i) => i.item_id === itemId);
		if (itemIndex === -1) return;

		const item = ticket.items[itemIndex];
		const newReturnedQty = item.returned_qty + returnedQty;
		const newDamagedQty = item.damaged_qty + damagedQty;

		ticket.items[itemIndex] = {
			...item,
			returned_qty: newReturnedQty,
			damaged_qty: newDamagedQty
		};

		const totalReturned = ticket.items.reduce((acc, curr) => acc + curr.returned_qty, 0);
		const totalDamaged = ticket.items.reduce((acc, curr) => acc + curr.damaged_qty, 0);

		let newStatus: RequisitionStatus = ticket.status;
		if (totalReturned + totalDamaged >= ticket.total_distributed && ticket.total_distributed > 0) {
			newStatus = 'completed';
		} else if (totalReturned > 0 || totalDamaged > 0) {
			newStatus = 'partially_returned';
		}

		this.requisitions[ticketIndex] = {
			...ticket,
			total_returned: totalReturned,
			total_damaged: totalDamaged,
			status: newStatus
		};

		this.closeReturnModal();
	}
}

export type { DistributionStore };

const DISTRIBUTION_STORE_KEY = Symbol('ONSITE_DISTRIBUTION_STORE');

export function setDistributionStore(): DistributionStore {
	return setContext(DISTRIBUTION_STORE_KEY, new DistributionStore());
}

export function getDistributionStore(): DistributionStore {
	const store = getContext<DistributionStore>(DISTRIBUTION_STORE_KEY);
	if (!store) {
		throw new Error(
			'getDistributionStore must be used under a component that called setDistributionStore'
		);
	}
	return store;
}
