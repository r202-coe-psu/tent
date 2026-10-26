<script lang="ts">
	import {
		useRequisitionTickets,
		resolveAuthenticatedAuthorContext
	} from '../../application/queries';
	import {
		canCreateTicket,
		canDispatchTicket,
		canReceiveWarehouseReturns,
		canPerformFrontlineDistribution
	} from '../../application/food-supplies/auth';
	import {
		type TicketWorkflowGroupId,
		computeTicketGroupCounts,
		constrainStatusesToGroup,
		filterAndSortRequisitionTickets,
		followUpStatusesFor,
		statusesForGroup
	} from '../model/ticket-filters';
	import {
		TICKET_URL_DEFAULTS,
		mergeTicketParams,
		parseTicketParams,
		serializeTicketParams,
		type TicketUrlState
	} from '../model/ticket-url-state';
	import {
		mergePoolParams,
		parsePoolParams,
		type DistributionView,
		type PoolUrlState
	} from '../model/pool-url-state';
	import { untrack } from 'svelte';
	import TicketGroupTabs from './TicketGroupTabs.svelte';
	import TicketFilters from './TicketFilters.svelte';
	import TicketTable from './TicketTable.svelte';
	import CreateTicketDialog from './CreateTicketDialog.svelte';
	import TicketDetailShell from './TicketDetailShell.svelte';
	import BulkReturnPoolBoard from '../bulk-return/BulkReturnPoolBoard.svelte';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Plus from '@lucide/svelte/icons/plus';
	import Truck from '@lucide/svelte/icons/truck';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import LogIn from '@lucide/svelte/icons/log-in';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock from '@lucide/svelte/icons/clock';
	import Send from '@lucide/svelte/icons/send';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import { mapDistributionQueryError } from '../model/distribution-error';
	import { authStore } from '$lib/stores/auth.svelte';

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// Authoritative tickets query
	const ticketsQuery = useRequisitionTickets(undefined, () => shelterCode);
	const tickets = $derived(ticketsQuery.data ?? []);
	const isLoading = $derived(ticketsQuery.isLoading);
	const isError = $derived(ticketsQuery.isError);
	const errorPresentation = $derived(mapDistributionQueryError(ticketsQuery.error));

	function handleReauth() {
		if (authStore.isAuthenticated) {
			// Opens the global non-dismissable login modal (no-op when already open).
			authStore.markNeedsReauth();
		} else {
			void goto(resolve('/login'));
		}
	}

	// Detail shell selection & deep linking (?ticketId=...)
	let localSelectedTicketId = $state<string | null>(null);
	const activeTicketId = $derived.by(() => {
		if (localSelectedTicketId) return localSelectedTicketId;
		try {
			return page.url.searchParams.get('ticketId') ?? '';
		} catch {
			return '';
		}
	});

	function handleOpenDetail(id: string) {
		localSelectedTicketId = id;
		try {
			const url = new URL(page.url);
			url.searchParams.set('ticketId', id);
			const search = url.searchParams.toString();
			const query = search ? `?${search}` : '';
			void goto(
				resolve(
					`/back-office/distribution${query}` as
						'/back-office/distribution' | `/back-office/distribution?${string}`
				),
				{
					replaceState: false,
					keepFocus: true,
					noScroll: true
				}
			);
		} catch {
			if (typeof window !== 'undefined') {
				const url = new URL(window.location.href);
				url.searchParams.set('ticketId', id);
				window.history.pushState({}, '', url.toString());
			}
		}
	}

	function handleCloseDetail() {
		localSelectedTicketId = null;
		try {
			const url = new URL(page.url);
			url.searchParams.delete('ticketId');
			const search = url.searchParams.toString();
			const query = search ? `?${search}` : '';
			void goto(
				resolve(
					`/back-office/distribution${query}` as
						'/back-office/distribution' | `/back-office/distribution?${string}`
				),
				{
					replaceState: false,
					keepFocus: true,
					noScroll: true
				}
			);
		} catch {
			if (typeof window !== 'undefined') {
				const url = new URL(window.location.href);
				url.searchParams.delete('ticketId');
				window.history.pushState({}, '', url.toString());
			}
		}
	}

	// Filter state lives in the URL (replaceState); foreign keys such as ticketId are preserved.
	const urlState = $derived.by(() => {
		try {
			return parseTicketParams(page.url.searchParams);
		} catch {
			return TICKET_URL_DEFAULTS;
		}
	});
	const activeGroup = $derived(urlState.group);
	const selectedType = $derived(urlState.type);
	const selectedDestination = $derived(urlState.dest);
	const selectedStatuses = $derived(urlState.status);
	const createdFrom = $derived(urlState.from);
	const createdTo = $derived(urlState.to);
	const followUp = $derived(urlState.follow);
	const sortDirection = $derived(urlState.sort);
	// Local copy so typing is never delayed by navigation; written through to `?q=`.
	let searchQuery = $state(untrack(() => urlState.q));

	function updateFilters(patch: Partial<TicketUrlState>) {
		const next = { ...urlState, ...patch };
		next.status = constrainStatusesToGroup(next.status, next.group);
		try {
			const qs = mergeTicketParams(page.url.searchParams, next).toString();
			if (qs === page.url.searchParams.toString()) return;
			void goto(
				resolve(
					`/back-office/distribution${qs ? `?${qs}` : ''}` as
						'/back-office/distribution' | `/back-office/distribution?${string}`
				),
				{ replaceState: true, keepFocus: true, noScroll: true }
			);
		} catch {
			// page.url unavailable — nothing to persist
		}
	}

	// Create dialog open state
	let isCreateOpen = $state(false);
	// View tab + open pool live in the URL (`?view=bulk_pools&pool=<id>`); foreign keys are preserved.
	const poolUrl = $derived.by(() => {
		try {
			return parsePoolParams(page.url.searchParams);
		} catch {
			return { view: 'tickets', pool: null } satisfies PoolUrlState;
		}
	});
	// Writable derived: the local value shows the tab at once, then re-syncs with the URL.
	let activeView = $derived<DistributionView>(poolUrl.view);

	function updatePoolParams(next: PoolUrlState) {
		try {
			const qs = mergePoolParams(page.url.searchParams, next).toString();
			if (qs === page.url.searchParams.toString()) return;
			void goto(
				resolve(
					`/back-office/distribution${qs ? `?${qs}` : ''}` as
						'/back-office/distribution' | `/back-office/distribution?${string}`
				),
				{ replaceState: true, keepFocus: true, noScroll: true }
			);
		} catch {
			// page.url unavailable — nothing to persist
		}
	}

	function handleViewChange(value: string) {
		const view: DistributionView = value === 'bulk_pools' ? 'bulk_pools' : 'tickets';
		activeView = view;
		updatePoolParams({ view, pool: null });
	}

	// RBAC: Check create capability from authoritative session context
	const authorContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(shelterCode);
		} catch {
			return null;
		}
	});
	const userCanCreate = $derived(authorContext ? canCreateTicket(authorContext) : false);
	const followUpStatuses = $derived(
		authorContext
			? followUpStatusesFor({
					canWarehouse:
						canDispatchTicket(authorContext) || canReceiveWarehouseReturns(authorContext),
					canFrontline: canPerformFrontlineDistribution(authorContext)
				})
			: []
	);
	const statusOptions = $derived(statusesForGroup(activeGroup));

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

	// Filtered & sorted tickets (default: created_at newest-first)
	const filteredTickets = $derived.by(() => {
		const base =
			followUp && followUpStatuses.length > 0
				? tickets.filter((t) => followUpStatuses.includes(t.status))
				: tickets;
		return filterAndSortRequisitionTickets(
			base,
			{
				groupId: activeGroup,
				requisitionType: selectedType,
				destination: selectedDestination,
				search: searchQuery,
				statuses: selectedStatuses,
				createdFrom,
				createdTo
			},
			{
				field: 'created_at',
				direction: sortDirection
			}
		);
	});

	// Changes whenever the filtered input changes, so the table returns to page 1.
	const filterKey = $derived(
		serializeTicketParams({ ...urlState, q: searchQuery, sort: 'desc' }).toString()
	);

	// Handle Group Tab change
	function handleSelectGroup(group: TicketWorkflowGroupId) {
		updateFilters({ group });
	}

	function handleResetFilters() {
		searchQuery = '';
		updateFilters({
			q: '',
			type: 'all',
			dest: 'all',
			group: 'all',
			status: [],
			from: '',
			to: '',
			follow: false
		});
	}

	function handleTicketCreated() {
		// Post-create UX: activate "รอจัด / พร้อมส่ง" so PENDING_PICK is immediately visible
		searchQuery = '';
		updateFilters({ ...TICKET_URL_DEFAULTS, group: 'pending_ready' });
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
					ศูนย์ควบคุมตั๋วเบิกจ่ายพัสดุ อาหารปรุงสุก และติดตามของยืม • ศูนย์: {shelterCode}
				</p>
			</div>
		</div>

		<div class="flex flex-wrap items-center justify-end gap-2">
			<!-- Action: Create Ticket (Guarded by RBAC canCreateTicket) -->
			{#if activeView === 'tickets' && userCanCreate}
				<Button
					type="button"
					onclick={() => (isCreateOpen = true)}
					class="h-auto shrink-0 gap-2 rounded-xl bg-[#0A2647] px-4 py-2.5 text-sm font-semibold text-white shadow-2xs hover:bg-[#051930]"
				>
					<Plus class="h-4 w-4" />
					<span>สร้างใบเบิกจ่าย</span>
				</Button>
			{/if}

			<Tabs.Root value={activeView} onValueChange={handleViewChange}>
				<Tabs.List
					class="h-auto w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-2xs"
					aria-label="มุมมองงานกระจายของ"
				>
					<Tabs.Trigger
						value="tickets"
						class="h-auto flex-none rounded-lg border-transparent px-3 py-2 text-xs font-semibold whitespace-nowrap text-slate-600 shadow-none transition-colors hover:bg-slate-50 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white data-[state=active]:shadow-none"
					>
						จัดการใบเบิกจ่าย
					</Tabs.Trigger>
					<Tabs.Trigger
						value="bulk_pools"
						class="h-auto flex-none rounded-lg border-transparent px-3 py-2 text-xs font-semibold whitespace-nowrap text-slate-600 shadow-none transition-colors hover:bg-slate-50 data-[state=active]:bg-violet-700 data-[state=active]:text-white data-[state=active]:shadow-none"
					>
						กองรับคืนพัสดุ
					</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>
		</div>
	</div>

	{#if activeView === 'bulk_pools'}
		<BulkReturnPoolBoard
			{shelterCode}
			initialPoolId={poolUrl.pool}
			onSelectedPoolChange={(pool) => updatePoolParams({ view: 'bulk_pools', pool })}
		/>
	{:else}
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

			<!-- Filters & Search -->
			<TicketFilters
				search={searchQuery}
				requisitionType={selectedType}
				destination={selectedDestination}
				destinations={availableDestinations}
				onSearchChange={(val) => {
					searchQuery = val;
					updateFilters({ q: val });
				}}
				onTypeChange={(type) => updateFilters({ type })}
				onDestinationChange={(dest) => updateFilters({ dest })}
				onResetFilters={handleResetFilters}
				{statusOptions}
				statuses={selectedStatuses}
				onStatusesChange={(status) => updateFilters({ status })}
				{createdFrom}
				{createdTo}
				onCreatedFromChange={(from) => updateFilters({ from })}
				onCreatedToChange={(to) => updateFilters({ to })}
				followUpAvailable={followUpStatuses.length > 0}
				{followUp}
				onFollowUpChange={(follow) => updateFilters({ follow })}
			/>

			<!-- Content: Loading, Error, or Table -->
			{#if isLoading}
				<div class="rounded-xl border border-slate-200/80 bg-white p-12 text-center shadow-2xs">
					<RefreshCw class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-400" />
					<p class="text-sm font-semibold text-slate-800">กำลังดึงข้อมูลตั๋วเบิกจ่าย...</p>
					<p class="mt-0.5 text-xs text-slate-500">กรุณารอสักครู่</p>
				</div>
			{:else if isError}
				<div
					role="alert"
					class="rounded-xl border border-red-200 bg-red-50/50 p-8 text-center shadow-2xs"
				>
					<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" aria-hidden="true" />
					<h3 class="text-sm font-bold text-red-900">{errorPresentation.title}</h3>
					<p class="mx-auto mt-1 max-w-md text-xs text-red-700">
						{errorPresentation.description}
					</p>
					{#if errorPresentation.actionType === 'reauth'}
						<Button
							type="button"
							variant="outline"
							onclick={handleReauth}
							class="mt-4 h-auto gap-1.5 rounded-lg border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-2xs hover:bg-red-50"
						>
							<LogIn class="h-3.5 w-3.5" aria-hidden="true" />
							<span>{errorPresentation.actionLabel}</span>
						</Button>
					{:else if errorPresentation.retryable}
						<Button
							type="button"
							variant="outline"
							onclick={() => ticketsQuery.refetch()}
							class="mt-4 h-auto gap-1.5 rounded-lg border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-2xs hover:bg-red-50"
						>
							<RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
							<span>{errorPresentation.actionLabel}</span>
						</Button>
					{/if}
				</div>
			{:else}
				<TicketTable
					tickets={filteredTickets}
					{sortDirection}
					resetKey={filterKey}
					onToggleSort={() => updateFilters({ sort: sortDirection === 'desc' ? 'asc' : 'desc' })}
					onViewTicket={(ticket) => handleOpenDetail(ticket._id)}
				/>
			{/if}
		</div>
	{/if}
</div>

<!-- Create Ticket Dialog (Stops strictly at PENDING_PICK) -->
<CreateTicketDialog
	bind:open={isCreateOpen}
	{shelterCode}
	onCreated={handleTicketCreated}
	onClose={() => (isCreateOpen = false)}
/>

<!-- Ticket Detail Shell Modal (State-driven detail & lifecycle actions) -->
{#if activeTicketId}
	<TicketDetailShell ticketId={activeTicketId} {shelterCode} onClose={handleCloseDetail} />
{/if}
