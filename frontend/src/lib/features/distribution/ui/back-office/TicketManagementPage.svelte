<script lang="ts">
	import {
		useRequisitionTickets,
		resolveAuthenticatedAuthorContext
	} from '../../application/queries';
	import { canCreateTicket } from '../../application/food-supplies/auth';
	import type { RequisitionTicketStatus } from '../../domain/food-supplies';
	import {
		type TicketWorkflowGroupId,
		computeTicketGroupCounts,
		filterRequisitionTickets,
		matchesWorkflowGroup
	} from '../model/ticket-filters';
	import TicketGroupTabs from './TicketGroupTabs.svelte';
	import TicketFilters from './TicketFilters.svelte';
	import TicketTable from './TicketTable.svelte';
	import CreateTicketDialog from './CreateTicketDialog.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import Plus from '@lucide/svelte/icons/plus';
	import Truck from '@lucide/svelte/icons/truck';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock from '@lucide/svelte/icons/clock';
	import Send from '@lucide/svelte/icons/send';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// Authoritative tickets query
	const ticketsQuery = useRequisitionTickets(undefined, () => shelterCode);
	const tickets = $derived(ticketsQuery.data ?? []);
	const isLoading = $derived(ticketsQuery.isLoading);
	const isError = $derived(ticketsQuery.isError);

	// Filter states
	let activeGroup = $state<TicketWorkflowGroupId>('all');
	let detailedStatus = $state<RequisitionTicketStatus | 'all'>('all');
	let selectedDestination = $state<string | 'all'>('all');
	let searchQuery = $state('');

	// Create dialog open state
	let isCreateOpen = $state(false);

	// RBAC: Check create capability from authoritative session context
	const userCanCreate = $derived.by(() => {
		try {
			const ctx = resolveAuthenticatedAuthorContext(shelterCode);
			return canCreateTicket(ctx);
		} catch {
			return false;
		}
	});

	// Group counts derived from the shared mapping
	const groupCounts = $derived(computeTicketGroupCounts(tickets));

	// Unique destinations from actual tickets
	const availableDestinations = $derived.by(() => {
		const list: string[] = [];
		for (const t of tickets) {
			if (t.destination_location && !list.includes(t.destination_location)) {
				list.push(t.destination_location);
			}
		}
		return list.sort((a, b) => a.localeCompare(b, 'th'));
	});

	// Filtered tickets
	const filteredTickets = $derived.by(() => {
		return filterRequisitionTickets(tickets, {
			groupId: activeGroup,
			detailedStatus,
			destination: selectedDestination,
			search: searchQuery
		});
	});

	// Handle Group Tab change
	function handleSelectGroup(group: TicketWorkflowGroupId) {
		activeGroup = group;
		// If detailed status doesn't belong to the newly selected group, reset it to avoid impossible filters
		if (
			detailedStatus !== 'all' &&
			group !== 'all' &&
			!matchesWorkflowGroup(detailedStatus, group)
		) {
			detailedStatus = 'all';
		}
	}

	// Handle Detailed Status change
	function handleStatusChange(status: RequisitionTicketStatus | 'all') {
		detailedStatus = status;
		// If selected status doesn't match active group, switch active group to all or matching group
		if (status !== 'all' && activeGroup !== 'all' && !matchesWorkflowGroup(status, activeGroup)) {
			activeGroup = 'all';
		}
	}

	function handleResetFilters() {
		searchQuery = '';
		detailedStatus = 'all';
		selectedDestination = 'all';
	}

	function handleTicketCreated() {
		// Post-create UX: activate "รอจัด / พร้อมส่ง" so PENDING_PICK is immediately visible
		activeGroup = 'pending_ready';
		detailedStatus = 'all';
		searchQuery = '';
		selectedDestination = 'all';
	}
</script>

<svelte:head>
	<title>จัดการการเบิกจ่ายพัสดุและอาหาร · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-6 bg-slate-50/50 p-4 sm:p-6 lg:p-8">
	<!-- Page Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<div
				class="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200/80 bg-sky-50 text-sky-700 shadow-2xs"
			>
				<Truck class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-slate-900">ระบบเบิกจ่ายพัสดุและอาหาร</h1>
				<p class="text-xs text-slate-500">
					ศูนย์ควบคุมตั๋วเบิกจ่ายพัสดุ อาหารปรุงสุก (Ready-Meal) และติดตามของยืม (CR-121) • ศูนย์: {shelterCode}
				</p>
			</div>
		</div>

		<!-- Action: Create Ticket (Guarded by RBAC canCreateTicket) -->
		{#if userCanCreate}
			<button
				type="button"
				onclick={() => (isCreateOpen = true)}
				class="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#0A2647] px-4 py-2.5 text-sm font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930]"
			>
				<Plus class="h-4 w-4" />
				<span>+ สร้างใบเบิกจ่าย</span>
			</button>
		{/if}
	</div>

	<!-- Overview KPI Counters (Single source of truth with workflow groups) -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
		<!-- 1. All -->
		<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-slate-500">ทั้งหมด</span>
				<ClipboardList class="h-4 w-4 text-slate-400" />
			</div>
			<div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
				{groupCounts.all}
			</div>
			<p class="mt-0.5 text-xs text-slate-400">รวมทุกสถานะ</p>
		</div>

		<!-- 2. Pending Pick & Ready -->
		<div class="rounded-xl border border-amber-200 bg-white p-4 shadow-2xs">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-amber-800">รอจัด / พร้อมส่ง</span>
				<Clock class="h-4 w-4 text-amber-600" />
			</div>
			<div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
				{groupCounts.pending_ready}
			</div>
			<p class="mt-0.5 text-xs text-amber-700">รอจัดของ • พร้อมส่งออก</p>
		</div>

		<!-- 3. In Progress -->
		<div class="rounded-xl border border-blue-200 bg-white p-4 shadow-2xs">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-blue-800">กำลังดำเนินการ</span>
				<Send class="h-4 w-4 text-blue-600" />
			</div>
			<div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
				{groupCounts.in_progress}
			</div>
			<p class="mt-0.5 text-xs text-blue-700">นำส่ง • แจกจ่าย • ปิดรอบ</p>
		</div>

		<!-- 4. Returns & Closeout -->
		<div class="rounded-xl border border-orange-200 bg-white p-4 shadow-2xs">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-orange-800">รับคืน / รอปิดงาน</span>
				<RotateCcw class="h-4 w-4 text-orange-600" />
			</div>
			<div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
				{groupCounts.returns_closeout}
			</div>
			<p class="mt-0.5 text-xs text-orange-700">รอตรวจรับคืน • ตรวจรับแล้ว</p>
		</div>

		<!-- 5. Completed -->
		<div
			class="col-span-2 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:col-span-1"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-slate-700">เสร็จสมบูรณ์</span>
				<CheckCircle2 class="h-4 w-4 text-emerald-600" />
			</div>
			<div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
				{groupCounts.completed}
			</div>
			<p class="mt-0.5 text-xs text-slate-400">สมบูรณ์ • ยกเลิก</p>
		</div>
	</div>

	<!-- Main Ticket Management Surface -->
	<div class="space-y-4">
		<!-- Grouped Workflow Tabs -->
		<TicketGroupTabs {activeGroup} counts={groupCounts} onSelectGroup={handleSelectGroup} />

		<!-- Detailed Filters & Search -->
		<TicketFilters
			search={searchQuery}
			{detailedStatus}
			destination={selectedDestination}
			destinations={availableDestinations}
			onSearchChange={(val) => (searchQuery = val)}
			onStatusChange={handleStatusChange}
			onDestinationChange={(dest) => (selectedDestination = dest)}
			onResetFilters={handleResetFilters}
		/>

		<!-- Content: Loading, Error, or Table -->
		{#if isLoading}
			<div class="rounded-xl border border-slate-200/80 bg-white p-12 text-center shadow-2xs">
				<RefreshCw class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-400" />
				<p class="text-sm font-semibold text-slate-800">
					กำลังดึงข้อมูลตั๋วเบิกจ่ายจาก Remote Database...
				</p>
				<p class="mt-0.5 text-xs text-slate-500">กรุณารอสักครู่</p>
			</div>
		{:else if isError}
			<div class="rounded-xl border border-red-200 bg-red-50/50 p-8 text-center shadow-2xs">
				<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" />
				<h3 class="text-sm font-bold text-red-900">ไม่สามารถเชื่อมต่อฐานข้อมูลตั๋วเบิกจ่ายได้</h3>
				<p class="mx-auto mt-1 max-w-md text-xs text-red-700">
					เกิดข้อผิดพลาดในการเรียกดูข้อมูล กรุณาตรวจสอบสัญญาณเครือข่ายหรือลองใหม่อีกครั้ง
				</p>
				<button
					type="button"
					onclick={() => ticketsQuery.refetch()}
					class="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-2xs transition-colors hover:bg-red-50"
				>
					<RefreshCw class="h-3.5 w-3.5" />
					<span>ลองใหม่</span>
				</button>
			</div>
		{:else}
			<TicketTable tickets={filteredTickets} />
		{/if}
	</div>
</div>

<!-- Create Ticket Dialog (Stops strictly at PENDING_PICK) -->
<CreateTicketDialog
	bind:open={isCreateOpen}
	{shelterCode}
	onCreated={handleTicketCreated}
	onClose={() => (isCreateOpen = false)}
/>
