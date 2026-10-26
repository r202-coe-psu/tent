<script lang="ts">
	import { createSubscriber } from 'svelte/reactivity';
	import type { Snippet } from 'svelte';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LogIn from '@lucide/svelte/icons/log-in';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Package from '@lucide/svelte/icons/package';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { useItemMasters } from '$lib/features/catalog';
	import { useEvacuees } from '$lib/features/people';
	import { useVolunteers } from '$lib/features/volunteers';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { addQty } from '$lib/utils/qty';
	import {
		resolveAuthenticatedAuthorContext,
		useBulkReturnPoolOverview,
		useBulkReturnSkippedDocs
	} from '../../application/queries';
	import {
		canManageBulkReturnPool,
		canWriteBulkReturnEntry
	} from '../../application/food-supplies/auth';
	import type { BulkReturnPoolOverviewRow } from '../../domain/food-supplies';
	import { mapDistributionQueryError } from '../model/distribution-error';
	import {
		LATE_BADGE_CLASS,
		LATE_CARD_EXCLUDED_TEXT,
		POOL_STATUS_FILTER_VALUES,
		RECEIVED_POOL_HIDE_AFTER_DAYS,
		UNRESOLVED_REFS_HINT,
		buildReturnerNames,
		filterPoolRows,
		getPoolBoardViewState,
		getPoolStatusBadgeClass,
		getPoolStatusFilterLabel,
		getPoolStatusLabel,
		hasActivePoolFilters,
		lateItemQtyText,
		poolItemIds,
		poolStatusCounts,
		poolStorageLabel,
		poolStorageOptions,
		receivedHideCutoff,
		resolveItemDisplay,
		type PoolCatalogItem,
		type PoolStatusFilter
	} from '../model/bulk-return-pool-v3';
	import { workQueuesFor } from '../model/bulk-return-work-queue';
	import { readMyPoolPoint, writeMyPoolPoint } from '../model/my-pool-point-storage';
	import { useStoragePoints } from '$lib/features/operations';
	import * as Select from '$lib/components/ui/select/index.js';
	import BulkReturnPoolWorkQueue from './BulkReturnPoolWorkQueue.svelte';
	import { listOpenPools } from '../model/bulk-return-add-entry';
	import AddBulkReturnEntriesDialog from './AddBulkReturnEntriesDialog.svelte';
	import BulkReturnPoolDetail from './BulkReturnPoolDetail.svelte';
	import BulkReturnPoolLifecycleActions from './BulkReturnPoolLifecycleActions.svelte';
	import OpenBulkReturnPoolDialog from './OpenBulkReturnPoolDialog.svelte';

	/**
	 * Bulk return pool v3 board (#659, #660): list, open, detail, add / move / void entries, edit
	 * header, cancel, submit to the warehouse ("เก็บเข้าคลัง") and receive ("ตรวจรับ"). Shared by the
	 * back-office and the onsite desk (role gates via canManage / canWriteEntry).
	 */
	interface Props {
		shelterCode?: string;
		/** Overrides the default submit / receive actions rendered in the pool detail header. */
		lifecycleActions?: Snippet<[BulkReturnPoolOverviewRow]>;
		/** Pool whose detail opens once its row is loaded (deep link, `?pool=`). */
		initialPoolId?: string | null;
		/** Fired whenever the open pool changes (`null` = closed), so the host can sync the URL. */
		onSelectedPoolChange?: (poolId: string | null) => void;
	}

	let { shelterCode, lifecycleActions, initialPoolId, onSelectedPoolChange }: Props = $props();

	const activeShelterCode = $derived(
		shelterCode ?? shelterStore.selectedShelterCode ?? getShelterCode()
	);

	// Malformed pool/entry/move/void docs the shelter reads leave out (shown, not swallowed).
	const skippedQuery = useBulkReturnSkippedDocs(undefined, () => activeShelterCode);
	const skippedDocs = $derived(skippedQuery.data ?? []);

	// CANCELLED rows are always fetched; the "show cancelled" toggle only filters the view.
	const overviewQuery = useBulkReturnPoolOverview(
		() => ({ includeCancelled: true }),
		() => activeShelterCode
	);
	const itemMastersQuery = useItemMasters(() => activeShelterCode ?? null);

	// Full rosters (loaded client-side) so the search and the detail can show returner names.
	const evacueesQuery = useEvacuees();
	const volunteersQuery = useVolunteers(undefined, () => activeShelterCode);
	const returnerNames = $derived(
		buildReturnerNames(evacueesQuery.data ?? [], volunteersQuery.data ?? [])
	);

	let search = $state('');
	let showCancelled = $state(false);
	// Local view filters (no persistence). 'all' is the sentinel for the two selects.
	let showOldReceived = $state(false);
	let statusFilter = $state<PoolStatusFilter>('all');
	let itemFilter = $state('all');
	let storageFilter = $state('all');
	let needsAttention = $state(false);
	let openDialogVisible = $state(false);
	let addDialogOpen = $state(false);
	let addPoolId = $state<string | undefined>(undefined);
	// Writable derived: follows `initialPoolId` (deep link / URL), local selections override it.
	let selectedPoolId = $derived<string | null>(initialPoolId ?? null);

	function selectPool(poolId: string | null) {
		selectedPoolId = poolId;
		onSelectedPoolChange?.(poolId);
	}

	// Fail closed: any problem resolving the session context hides the write actions.
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(activeShelterCode);
		} catch {
			return null;
		}
	});
	const canManage = $derived(authContext ? canManageBulkReturnPool(authContext) : false);
	const canWriteEntry = $derived(authContext ? canWriteBulkReturnEntry(authContext) : false);

	const queues = $derived(authContext ? workQueuesFor(authContext) : []);

	// Per-device "my point" for the distribution staff queue; re-read when the shelter changes.
	// The hook has no enable switch, so it always loads (the shelter doc is shared and cached).
	const storagePoints = useStoragePoints(() => activeShelterCode ?? '');
	let myPoint = $derived<string | null>(readMyPoolPoint(activeShelterCode));

	function handleMyPointChange(value: string) {
		myPoint = value;
		writeMyPoolPoint(activeShelterCode, value);
	}

	// Ticks every minute so the "waiting since" ages stay fresh.
	// Ticks every minute (only while something reads it) so waiting ages stay current.
	const subscribeMinute = createSubscriber((update) => {
		const timer = setInterval(update, 60_000);
		return () => clearInterval(timer);
	});
	const now = $derived.by(() => {
		subscribeMinute();
		return new Date();
	});

	const rows = $derived(overviewQuery.data ?? []);
	const hasOpenPool = $derived(listOpenPools(rows).length > 0);

	function handleAddEntry(poolId?: string) {
		addPoolId = poolId;
		addDialogOpen = true;
	}
	const hideReceivedBefore = $derived(showOldReceived ? undefined : receivedHideCutoff());
	const rowFilter = $derived({
		search,
		showCancelled,
		hideReceivedBefore,
		status: statusFilter,
		itemId: itemFilter === 'all' ? undefined : itemFilter,
		storagePointId: storageFilter === 'all' ? undefined : storageFilter,
		needsAttention,
		returnerNames
	});
	const visibleRows = $derived(filterPoolRows(rows, rowFilter));
	const statusCounts = $derived(poolStatusCounts(rows, { showCancelled, hideReceivedBefore }));
	const filtersActive = $derived(hasActivePoolFilters(rowFilter));
	const catalog = $derived.by((): PoolCatalogItem[] =>
		(itemMastersQuery.data ?? []).map((item) => ({
			_id: item._id,
			name: item.name,
			base_unit: item.base_unit
		}))
	);

	const itemOptions = $derived(
		poolItemIds(rows)
			.map((id) => ({ id, name: resolveItemDisplay(id, catalog).name }))
			.sort((a, b) => a.name.localeCompare(b.name, 'th'))
	);
	const storageOptions = $derived(poolStorageOptions(rows));
	const itemFilterLabel = $derived(
		itemFilter === 'all'
			? 'ทุกชนิด'
			: (itemOptions.find((o) => o.id === itemFilter)?.name ??
					resolveItemDisplay(itemFilter, catalog).name)
	);
	const storageFilterLabel = $derived(
		storageFilter === 'all'
			? 'ทุกที่เก็บ'
			: (storageOptions.find((o) => o.value === storageFilter)?.label ?? storageFilter)
	);

	function resetFilters() {
		search = '';
		statusFilter = 'all';
		itemFilter = 'all';
		storageFilter = 'all';
		needsAttention = false;
	}
	// Total considered for the empty state respects the cancelled toggle.
	const totalRowCount = $derived(
		showCancelled ? rows.length : rows.filter((row) => row.pool.status !== 'CANCELLED').length
	);
	const viewState = $derived(
		getPoolBoardViewState(
			Boolean(overviewQuery.isLoading),
			Boolean(overviewQuery.isError),
			totalRowCount,
			visibleRows.length
		)
	);
	const errorPresentation = $derived(mapDistributionQueryError(overviewQuery.error));

	// Detail follows the live overview row, so it refreshes after every mutation. Read `rows` on
	// every run (no short-circuit): a run with no selection must still track `rows`, or later
	// refetches never reach the open sheet (BRP-F10).
	const selectedRow = $derived.by(() => {
		const list = rows;
		const id = selectedPoolId;
		return id ? (list.find((row) => row.pool._id === id) ?? null) : null;
	});

	/** Sum of late-entry qty per item_id (late entries are already non-voided). */
	function lateQtyByItem(row: BulkReturnPoolOverviewRow): Record<string, string> {
		const totals: Record<string, string> = {};
		for (const late of row.late_entries) {
			const id = late.entry.item_id;
			totals[id] = addQty(totals[id] ?? '0', late.entry.qty);
		}
		return totals;
	}

	function handleReauth() {
		if (authStore.isAuthenticated) {
			authStore.markNeedsReauth();
		} else {
			void goto(resolve('/login'));
		}
	}
</script>

<section class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-6">
	<div
		class="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shadow-2xs"
			>
				<Package class="h-6 w-6" aria-hidden="true" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-slate-900">กองรับคืน</h2>
				<p class="text-sm text-slate-500">
					รวมของที่รับคืนไว้เป็นกอง ๆ ก่อนส่งเข้าคลัง · ศูนย์ {activeShelterCode}
				</p>
			</div>
		</div>
		{#if canManage || (canWriteEntry && hasOpenPool)}
			<div class="flex flex-col gap-2 sm:flex-row">
				{#if canWriteEntry && hasOpenPool}
					<Button
						type="button"
						onclick={() => handleAddEntry()}
						class="min-h-11 w-full gap-2 sm:w-auto"
					>
						<PackagePlus class="h-4 w-4" aria-hidden="true" />
						รับของเข้ากอง
					</Button>
				{/if}
				{#if canManage}
					<Button
						type="button"
						variant={canWriteEntry && hasOpenPool ? 'outline' : 'default'}
						onclick={() => (openDialogVisible = true)}
						class="min-h-11 w-full gap-2 sm:w-auto"
					>
						<Plus class="h-4 w-4" aria-hidden="true" />
						เปิดกองใหม่
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	{#if skippedDocs.length > 0}
		<div
			role="status"
			data-testid="bulk-return-board-skipped-docs"
			class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
			<p class="min-w-0 [overflow-wrap:anywhere]">
				พบเอกสารกองรับคืนที่ข้อมูลไม่ถูกต้อง <span class="tabular-nums">{skippedDocs.length}</span>
				รายการในศูนย์นี้ ระบบข้ามไว้ไม่แสดง กองที่เกี่ยวข้องจะย้าย ยกเลิกรายการ หรือส่งเข้าคลังไม่ได้จนกว่าจะแก้ไข
				— ติดต่อผู้ดูแลระบบ
			</p>
		</div>
	{/if}

	<BulkReturnPoolWorkQueue
		{rows}
		{queues}
		{now}
		onOpenPool={(poolId) => selectPool(poolId)}
		points={storagePoints.points}
		{myPoint}
		onMyPointChange={handleMyPointChange}
	/>

	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="relative w-full sm:max-w-sm">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
				aria-hidden="true"
			/>
			<Input
				type="search"
				bind:value={search}
				placeholder="ค้นหาชื่อกองหรือชื่อผู้คืน"
				aria-label="ค้นหากองรับคืนตามชื่อกองหรือชื่อผู้คืน"
				class="h-11 w-full pl-9 text-base sm:h-10 sm:text-sm"
			/>
		</div>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<div class="flex min-h-11 items-center gap-2">
				<Switch id="bulk-pool-show-cancelled" bind:checked={showCancelled} />
				<Label for="bulk-pool-show-cancelled" class="text-sm font-medium text-slate-700">
					แสดงกองที่ยกเลิก
				</Label>
			</div>
			<div class="flex min-h-11 items-center gap-2">
				<Switch id="bulk-pool-show-old-received" bind:checked={showOldReceived} />
				<Label for="bulk-pool-show-old-received" class="text-sm font-medium text-slate-700">
					แสดงกองที่ตรวจรับเกิน {RECEIVED_POOL_HIDE_AFTER_DAYS} วัน
				</Label>
			</div>
		</div>
	</div>

	<div class="flex flex-col gap-3">
		<div role="group" aria-label="กรองกองรับคืนตามสถานะ" class="flex flex-wrap gap-2">
			{#each POOL_STATUS_FILTER_VALUES as value (value)}
				<Button
					type="button"
					variant={statusFilter === value ? 'default' : 'outline'}
					aria-pressed={statusFilter === value}
					onclick={() => (statusFilter = value)}
					class="min-h-11 gap-2"
				>
					{getPoolStatusFilterLabel(value)}
					<span class="tabular-nums">{statusCounts[value]}</span>
				</Button>
			{/each}
		</div>

		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			{#if itemOptions.length > 0}
				<div class="flex items-center gap-2">
					<Label for="bulk-pool-item-filter" class="shrink-0 text-sm font-medium text-slate-700">
						ชนิดสินค้า
					</Label>
					<Select.Root
						type="single"
						value={itemFilter}
						onValueChange={(val) => {
							if (val) itemFilter = val;
						}}
					>
						<Select.Trigger
							id="bulk-pool-item-filter"
							aria-label="กรองตามชนิดสินค้า"
							class="min-h-11 min-w-[160px]"
						>
							<span class="truncate">{itemFilterLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all" label="ทุกชนิด" />
							{#each itemOptions as option (option.id)}
								<Select.Item value={option.id} label={option.name} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			{#if storageOptions.length >= 2}
				<div class="flex items-center gap-2">
					<Label for="bulk-pool-storage-filter" class="shrink-0 text-sm font-medium text-slate-700">
						ที่เก็บ
					</Label>
					<Select.Root
						type="single"
						value={storageFilter}
						onValueChange={(val) => {
							if (val) storageFilter = val;
						}}
					>
						<Select.Trigger
							id="bulk-pool-storage-filter"
							aria-label="กรองตามที่เก็บ"
							class="min-h-11 min-w-[160px]"
						>
							<span class="truncate">{storageFilterLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all" label="ทุกที่เก็บ" />
							{#each storageOptions as option (option.value)}
								<Select.Item value={option.value} label={option.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<div class="flex min-h-11 items-center gap-2">
				<Switch id="bulk-pool-needs-attention" bind:checked={needsAttention} />
				<Label for="bulk-pool-needs-attention" class="text-sm font-medium text-slate-700">
					ต้องจัดการ
				</Label>
			</div>

			{#if filtersActive}
				<Button type="button" variant="ghost" onclick={resetFilters} class="min-h-11 gap-2">
					<XCircle class="h-4 w-4" aria-hidden="true" />
					ล้างตัวกรอง
				</Button>
			{/if}
		</div>
	</div>

	{#if viewState === 'loading'}
		<div role="status" class="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
			<RefreshCw class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
			<p class="text-sm font-semibold text-slate-800">กำลังโหลดข้อมูลกองรับคืน...</p>
		</div>
	{:else if viewState === 'error'}
		<div role="alert" class="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
			<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" aria-hidden="true" />
			<h3 class="text-base font-bold text-red-900">ไม่สามารถโหลดข้อมูลกองรับคืนได้</h3>
			<p class="mx-auto mt-1 max-w-md text-sm text-red-800">{errorPresentation.description}</p>
			{#if errorPresentation.actionType === 'reauth'}
				<Button
					type="button"
					variant="outline"
					onclick={handleReauth}
					class="mt-4 min-h-11 gap-2 border-red-200 bg-white text-red-800 hover:bg-red-50"
				>
					<LogIn class="h-4 w-4" aria-hidden="true" />
					{errorPresentation.actionLabel}
				</Button>
			{:else if errorPresentation.retryable}
				<Button
					type="button"
					variant="outline"
					onclick={() => overviewQuery.refetch()}
					class="mt-4 min-h-11 gap-2 border-red-200 bg-white text-red-800 hover:bg-red-50"
				>
					<RefreshCw class="h-4 w-4" aria-hidden="true" />
					{errorPresentation.actionLabel}
				</Button>
			{/if}
		</div>
	{:else if viewState === 'empty'}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
			<Inbox class="mx-auto mb-2 h-8 w-8 text-slate-400" aria-hidden="true" />
			<h3 class="text-base font-semibold text-slate-900">ยังไม่มีกองรับคืน</h3>
			<p class="mt-1 text-sm text-slate-500">
				{canManage
					? 'กด "เปิดกองใหม่" เพื่อเริ่มรวบรวมของที่รับคืน'
					: 'ยังไม่มีกองที่เปิดในศูนย์นี้'}
			</p>
		</div>
	{:else if viewState === 'search_empty'}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
			<XCircle class="mx-auto mb-2 h-8 w-8 text-slate-400" aria-hidden="true" />
			<h3 class="text-base font-semibold text-slate-900">ไม่พบกองที่ตรงกับการค้นหา</h3>
			<p class="mt-1 text-sm text-slate-500">ลองค้นหาด้วยชื่อกองหรือชื่อผู้คืนอื่น</p>
		</div>
	{:else}
		<ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			{#each visibleRows as row (row.pool._id)}
				{@const pool = row.pool}
				<li>
					<button
						type="button"
						onclick={() => selectPool(pool._id)}
						class="flex min-h-11 w-full flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						<div class="flex flex-wrap items-start justify-between gap-2">
							<span class="text-base font-semibold break-words text-slate-900">{pool.name}</span>
							<span class="flex flex-wrap items-center gap-1.5">
								{#if row.late_entries.length > 0}
									<span
										class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold {LATE_BADGE_CLASS}"
									>
										<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
										ค้าง <span class="tabular-nums">{row.late_entries.length}</span>
									</span>
								{/if}
								{#if row.closed_loan_refs.length > 0}
									<span
										class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold {LATE_BADGE_CLASS}"
										data-testid="bulk-return-card-closed-loan-hint"
									>
										<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
										ยอดยืมถูกปิด <span class="tabular-nums">{row.closed_loan_refs.length}</span>
									</span>
								{/if}
								{#if row.unresolved_refs.length > 0}
									<span
										class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold {LATE_BADGE_CLASS}"
										title={UNRESOLVED_REFS_HINT}
									>
										<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
										รอซิงก์ <span class="tabular-nums">{row.unresolved_refs.length}</span>
										<span class="sr-only">{UNRESOLVED_REFS_HINT}</span>
									</span>
								{/if}
								<span
									class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {getPoolStatusBadgeClass(
										pool.status
									)}"
								>
									{getPoolStatusLabel(pool.status)}
								</span>
							</span>
						</div>

						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
							<span class="inline-flex items-center gap-1.5">
								<MapPin class="h-4 w-4 text-slate-400" aria-hidden="true" />
								{poolStorageLabel(pool)}
							</span>
							<span>
								<span class="font-semibold text-slate-900 tabular-nums">{row.entry_count}</span>
								รายการ
							</span>
							{#if row.late_entries.length > 0}
								<span
									class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold {LATE_BADGE_CLASS}"
								>
									ค้าง <span class="tabular-nums">{row.late_entries.length}</span>
									· {LATE_CARD_EXCLUDED_TEXT}
								</span>
							{/if}
						</div>

						{#if row.items.length > 0}
							{@const lateByItem = lateQtyByItem(row)}
							<ul class="space-y-0.5 text-sm text-slate-700">
								{#each row.items as summary (summary.item_id)}
									{@const item = resolveItemDisplay(summary.item_id, catalog)}
									{@const lateQty = lateByItem[summary.item_id]}
									<li class="flex items-baseline justify-between gap-3">
										<span class="break-words">{item.name}</span>
										<span class="flex shrink-0 flex-col items-end">
											<span class="font-semibold tabular-nums">
												{summary.qty}
												{item.unit}
											</span>
											{#if lateQty}
												<span class="text-xs font-medium text-amber-700 tabular-nums">
													{lateItemQtyText(lateQty, item.unit)}
												</span>
											{/if}
										</span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-sm text-slate-500">ยังไม่มีสินค้าในกอง</p>
						{/if}

						<p class="text-xs text-slate-500">
							เปิดโดย {pool.created_by} ·
							<span class="tabular-nums">{formatThaiDateTime(pool.created_at)}</span>
						</p>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if openDialogVisible}
	<OpenBulkReturnPoolDialog
		shelterCode={activeShelterCode}
		{rows}
		onClose={() => (openDialogVisible = false)}
		onOpened={(pool) => selectPool(pool._id)}
	/>
{/if}

{#snippet defaultLifecycleActions(row: BulkReturnPoolOverviewRow)}
	<BulkReturnPoolLifecycleActions {row} {catalog} shelterCode={activeShelterCode} {canManage} />
{/snippet}

<!-- Keyed by pool id so dialog/confirm state never leaks from one pool to the next. -->
{#key selectedPoolId}
	<BulkReturnPoolDetail
		row={selectedRow}
		{rows}
		{catalog}
		{returnerNames}
		shelterCode={activeShelterCode}
		{canManage}
		{canWriteEntry}
		onAddEntry={handleAddEntry}
		lifecycleActions={lifecycleActions ?? defaultLifecycleActions}
		onClose={() => selectPool(null)}
	/>
{/key}

{#if canWriteEntry}
	<AddBulkReturnEntriesDialog
		bind:open={addDialogOpen}
		shelterCode={activeShelterCode}
		initialPoolId={addPoolId}
	/>
{/if}
