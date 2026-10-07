<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import {
		useStockBalance,
		useLedger,
		useCrossShelterStockBalances,
		useCrossShelterLedger
	} from '../application/queries';
	import { useSupplyItems, useThresholdOverrides } from '$lib/features/supply';
	import { SUPPLY_CATEGORY_LABELS, type SupplyCategory } from '$lib/features/supply';
	import {
		itemMasterUnit,
		useItemMasters,
		useItemCategories,
		formatUnit,
		useUnitsOfMeasure,
		resolveCategoryLabel
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import { useShelters } from '$lib/features/shelters';
	import { getShelterCode } from '$lib/db/shelter';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import ItemDetailSheet from './item-detail-sheet.svelte';
	import ReceiveStockForm from './receive-stock-form.svelte';
	import DistributeStockForm from './distribute-stock-form.svelte';
	import AdjustStockForm from './adjust-stock-form.svelte';
	import AttentionCards from './stock/attention-cards.svelte';
	import StockFilters from './stock/stock-filters.svelte';
	import StockRow from './stock/stock-row.svelte';
	import StockCard from './stock/stock-card.svelte';
	import {
		attentionCounts,
		clampPage,
		filterRows,
		hiddenCatalogCount,
		pageSlice,
		sortRows,
		visibleRows,
		type StockDisplayRow
	} from './stock/stock-view';
	import {
		mergeStockParams,
		parseStockParams,
		STOCK_PAGE_SIZE,
		type StockUrlState
	} from './stock/stock-url-state';
	import {
		projectStockLotBalances,
		StockLotIntegrityError,
		type StockLotBalance
	} from '../domain/operations';
	import {
		dailyConsumption,
		daysOfCover,
		deriveStockQtyStatus,
		everStockedItemIds,
		groupLotsByItem,
		resolveReorderThreshold,
		summarizeItemStock,
		type ItemStockSummary
	} from '../domain/stock-summary';
	import { lotStorageKey, lotStorageName } from '../domain/lot-storage';
	import { toLotPriorityItems } from '../domain/lot-priority';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import { qtyGt, addQty } from '$lib/utils/qty';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

	let { occupancy = 120 }: { occupancy?: number } = $props();

	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const itemCategoriesQuery = useItemCategories(() => getShelterCode());
	const itemCategories = $derived(itemCategoriesQuery.data ?? []);
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const overridesQuery = useThresholdOverrides();

	const overrides = $derived(overridesQuery.data ?? []);
	const overrideByItem = $derived(new Map(overrides.map((o) => [o.item_id, o])));

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	let showOverall = $state(false);

	const sheltersQuery = useShelters();
	const storagePoints = useStoragePoints(() => getShelterCode());
	const shelterCodes = $derived((sheltersQuery.data ?? []).map((s) => s.code));

	const crossBalanceQuery = useCrossShelterStockBalances(
		() => shelterCodes,
		() => isSA && showOverall
	);
	const crossLedgerQuery = useCrossShelterLedger(
		() => shelterCodes,
		() => isSA && showOverall
	);

	// Filter / sort / page live in the URL (`?q=&cat=&loc=&status=&sort=&page=&all=`) so a
	// reload or a shared link restores the view. Other params (`tab`, …) are preserved.
	const urlState = $derived(parseStockParams(page.url.searchParams));

	function updateUrl(patch: Partial<StockUrlState>) {
		// Any filter / sort change goes back to page 1; only an explicit `page` keeps its value.
		const next: StockUrlState = { ...urlState, page: 1, ...patch };
		const params = mergeStockParams(page.url.searchParams, next);
		const qs = params.toString();
		if (qs === page.url.searchParams.toString()) return;
		void goto(resolve(`/back-office/supply${qs ? `?${qs}` : ''}` as '/back-office/supply'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	let selectedItemId = $state<string | null>(null);
	let detailOpen = $state(false);
	let quickActionOpen = $state(false);
	let quickActionKind = $state<'receive' | 'distribute' | 'adjust'>('receive');
	let quickActionItemId = $state<string | undefined>(undefined);
	const isMobileViewport = new IsMobile();

	function openDetail(itemId: string) {
		selectedItemId = itemId;
		detailOpen = true;
	}

	function openQuickAction(kind: 'receive' | 'distribute' | 'adjust', itemId?: string) {
		quickActionKind = kind;
		quickActionItemId = itemId;
		quickActionOpen = true;
	}

	function onMovementSuccess(result?: { keepOpen?: boolean }) {
		// Keep overlay/panel open for the next line unless the form asked to close.
		if (result?.keepOpen === false) {
			quickActionOpen = false;
		}
	}

	const quickActionTitle = $derived(
		quickActionKind === 'receive'
			? 'รับเข้า'
			: quickActionKind === 'distribute'
				? 'เบิกจ่าย'
				: 'ปรับยอด / ตรวจนับ'
	);
	const quickActionDescription = $derived(
		quickActionKind === 'receive'
			? 'บันทึกรับพัสดุเข้าคลัง'
			: quickActionKind === 'distribute'
				? 'ระบบเลือกล็อตที่ควรใช้ก่อนให้อัตโนมัติ'
				: 'กรอกจำนวนที่นับได้จริง แล้วระบบจะคำนวณส่วนต่างให้อัตโนมัติ'
	);

	const items = $derived.by(() => {
		const supplyItems = (itemsQuery.data ?? []).map((si) => ({
			...si,
			target_reserve_days: si.target_reserve_days,
			consumption_rate: si.consumption_rate,
			timeframe: si.timeframe
		}));
		const itemMasters = itemMastersQuery.data ?? [];

		const mappedItemMasters = itemMasters.map((im) => ({
			_id: im._id,
			name: im.name,
			category: im.category || 'other',
			unit: itemMasterUnit(im),
			reorder_level: null,
			perishable: false,
			target_reserve_days: undefined,
			consumption_rate: undefined,
			timeframe: undefined
		}));

		return [...supplyItems, ...mappedItemMasters];
	});

	const balance = $derived.by(() => {
		if (isSA && showOverall) {
			const agg = new SvelteMap<string, string>();
			const data = crossBalanceQuery.data ?? [];
			for (const { balance: b } of data) {
				for (const [itemId, qty] of b.entries()) {
					agg.set(itemId, addQty(agg.get(itemId) ?? '0', qty));
				}
			}
			return agg;
		}
		return balanceQuery.data ?? new SvelteMap<string, string>();
	});

	const ledger = $derived(
		isSA && showOverall ? (crossLedgerQuery.data ?? []) : (ledgerQuery.data ?? [])
	);

	/**
	 * Location filter options from ledger entries, keyed by `lotStorageKey` so a
	 * renamed storage point stays one option (draft-shelter-storage-points).
	 */
	const uniqueLocations = $derived.by(() => {
		const locations = new SvelteMap<string, string>();
		for (const entry of ledger) {
			const key = lotStorageKey(entry.lot);
			const name = lotStorageName(entry.lot, storagePoints.points);
			if (key && name && !locations.has(key)) locations.set(key, name);
		}
		return Array.from(locations, ([value, label]) => ({ value, label }));
	});

	/** Remaining lots per item — every lot, so an old lot near expiry is never hidden. */
	const lotsByItem = $derived.by(() => {
		try {
			return groupLotsByItem(projectStockLotBalances(ledger));
		} catch (error) {
			if (!(error instanceof StockLotIntegrityError)) throw error;
			return new SvelteMap<string, StockLotBalance[]>();
		}
	});

	/** Shelf life / storage type per item, for the lot order shown in the detail panel. */
	const lotPriorityItems = $derived(toLotPriorityItems(itemMastersQuery.data ?? []));

	const stockSummaryByItem = $derived.by(() => {
		const result = new SvelteMap<string, ItemStockSummary>();
		for (const [itemId, lots] of lotsByItem) result.set(itemId, summarizeItemStock(lots));
		return result;
	});

	/** Location label: the single storage point, or the first one plus a count. */
	const locationLabelByItem = $derived.by(() => {
		const result = new SvelteMap<string, string>();
		for (const [itemId, lots] of lotsByItem) {
			const names = [
				...new Set(
					lots
						.filter((l) => qtyGt(l.qty, 0))
						.map((l) => lotStorageName(l.lot, storagePoints.points))
						.filter((n): n is string => !!n)
				)
			];
			if (names.length > 0) {
				result.set(itemId, names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`);
			}
		}
		return result;
	});

	function getCategoryLabel(category: string): string {
		if (category in SUPPLY_CATEGORY_LABELS) {
			return SUPPLY_CATEGORY_LABELS[category as SupplyCategory];
		}
		return resolveCategoryLabel(category, itemCategories) || category;
	}

	const uniqueCategories = $derived.by(() => {
		const cats = new SvelteSet<string>();
		for (const item of items) {
			if (item.category) {
				cats.add(item.category);
			}
		}
		return Array.from(cats)
			.map((cat) => ({
				value: cat,
				label: getCategoryLabel(cat)
			}))
			.sort((a, b) => a.label.localeCompare(b.label, 'th'));
	});

	/** "Ever stocked" = at least one ledger row at this shelter; the rest are catalog-only. */
	const everStocked = $derived(everStockedItemIds(ledger));

	const rows = $derived.by<StockDisplayRow[]>(() =>
		items.map((item) => {
			const qtyOnHand = balance.get(item._id) ?? '0';
			const override = overrideByItem.get(item._id);
			const reorderThreshold = resolveReorderThreshold(occupancy, item, override);
			const summary = stockSummaryByItem.get(item._id);
			return {
				_id: item._id,
				name: item.name,
				category: item.category,
				categoryLabel: getCategoryLabel(item.category),
				unitLabel: formatUnit(item.unit, units, langState.current),
				qtyOnHand,
				reorderThreshold,
				status: deriveStockQtyStatus(qtyOnHand, reorderThreshold),
				expiryState: summary?.expiryState ?? 'none',
				earliestExpiry: summary?.earliestExpiry ?? null,
				storageKeys: summary?.storageKeys ?? [],
				lotCount: summary?.lotCount ?? 0,
				locationLabel: locationLabelByItem.get(item._id) ?? null,
				coverDays: daysOfCover(qtyOnHand, dailyConsumption(occupancy, item, override)),
				neverReceived: !everStocked.has(item._id)
			};
		})
	);

	// Card counts ignore search / category / location / status so they stay stable while filtering.
	const counts = $derived(attentionCounts(visibleRows(rows, urlState.all)));
	const hiddenCount = $derived(urlState.all ? 0 : hiddenCatalogCount(rows));

	const filteredRows = $derived(sortRows(filterRows(rows, urlState), urlState.sort));
	const currentPage = $derived(clampPage(urlState.page, filteredRows.length, STOCK_PAGE_SIZE));
	const pageRows = $derived(pageSlice(filteredRows, currentPage, STOCK_PAGE_SIZE));
	const rangeStart = $derived(
		filteredRows.length === 0 ? 0 : (currentPage - 1) * STOCK_PAGE_SIZE + 1
	);
	const rangeEnd = $derived((currentPage - 1) * STOCK_PAGE_SIZE + pageRows.length);

	const filtersActive = $derived(
		urlState.q.trim() !== '' ||
			urlState.cat !== 'all' ||
			urlState.loc !== 'all' ||
			urlState.status !== 'all'
	);

	const isLoading = $derived(
		itemsQuery.isLoading ||
			itemMastersQuery.isLoading ||
			overridesQuery.isLoading ||
			(isSA && showOverall
				? crossBalanceQuery.isLoading || crossLedgerQuery.isLoading
				: balanceQuery.isLoading || ledgerQuery.isLoading)
	);

	// Cross-shelter totals are view-only: opening an item or moving stock would act on one shelter.
	const readonly = $derived(isSA && showOverall);

	// Session expired (`needsReauth`): reading still works, every write button is off.
	const offline = $derived(authStore.needsReauth);
	const OFFLINE_HINT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่เพื่อบันทึก';

	function clearFilters() {
		updateUrl({ q: '', cat: 'all', loc: 'all', status: 'all' });
	}

	const selectedManageItem = $derived(
		selectedItemId ? rows.find((r) => r._id === selectedItemId) : undefined
	);
</script>

<div class="space-y-4 pb-20 md:pb-0">
	<!-- Header + CTAs (the 3 movement buttons move to a bottom bar below md) -->
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<h2 class="text-lg font-bold text-slate-900 sm:text-xl">รายการพัสดุในคลัง</h2>
		<div class="flex flex-wrap gap-2 md:justify-end">
			<div class="hidden gap-2 md:flex">
				<Button
					type="button"
					class="min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930]"
					disabled={offline}
					title={offline ? OFFLINE_HINT : undefined}
					onclick={() => openQuickAction('receive')}
				>
					<ArrowDownToLine class="h-4 w-4" aria-hidden="true" />
					รับเข้า
				</Button>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 gap-2 rounded-lg border-slate-300 px-4 text-sm font-semibold text-slate-800 shadow-2xs"
					disabled={offline}
					title={offline ? OFFLINE_HINT : undefined}
					onclick={() => openQuickAction('distribute')}
				>
					<ArrowUpFromLine class="h-4 w-4" aria-hidden="true" />
					เบิกจ่าย
				</Button>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 gap-2 rounded-lg border-slate-300 px-4 text-sm font-semibold text-slate-800 shadow-2xs"
					disabled={offline}
					title={offline ? OFFLINE_HINT : undefined}
					onclick={() => openQuickAction('adjust')}
				>
					<SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
					ปรับยอด / ตรวจนับ
				</Button>
			</div>
			<a
				href={resolve('/back-office/supply?tab=catalog&action=create' as '/back-office/supply')}
				class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-900 shadow-2xs transition-colors hover:bg-teal-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none md:w-auto"
			>
				<Plus class="h-4 w-4" aria-hidden="true" />
				เพิ่มของใหม่
			</a>
		</div>
	</div>

	<AttentionCards
		{counts}
		selected={urlState.status}
		onselect={(status) => updateUrl({ status })}
	/>

	<div
		class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
	>
		<StockFilters
			q={urlState.q}
			cat={urlState.cat}
			loc={urlState.loc}
			sort={urlState.sort}
			all={urlState.all}
			categories={uniqueCategories}
			locations={uniqueLocations}
			bind:showOverall
			canShowOverall={isSA}
			onchange={updateUrl}
		/>

		{#if isLoading}
			<div class="flex-1 space-y-3 p-4">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center p-12 text-center">
				<Boxes class="mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
				<h3 class="text-base font-semibold text-slate-900">ยังไม่มีรายการพัสดุในระบบ</h3>
				<p class="mt-1 text-sm text-slate-500">
					เพิ่มของใหม่ หรือเปิดแท็บสินค้า (Master) เพื่อเริ่มต้น
				</p>
			</div>
		{:else}
			<p
				class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600"
			>
				<span>
					กำลังแสดง <strong class="font-semibold text-slate-900 tabular-nums">
						{filteredRows.length}
					</strong> รายการ
				</span>
				{#if hiddenCount > 0}
					<span aria-hidden="true" class="text-slate-400">·</span>
					<span>ซ่อน {hiddenCount} รายการในแคตตาล็อกที่ศูนย์นี้ไม่เคยรับเข้า</span>
				{/if}
				{#if filtersActive}
					<button
						type="button"
						onclick={clearFilters}
						class="min-h-11 rounded px-2 font-semibold text-sky-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						ล้างตัวกรอง
					</button>
				{/if}
			</p>

			{#if filteredRows.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
					{#if !urlState.all && !filtersActive && hiddenCount > 0}
						<p class="text-sm font-medium text-slate-600">ศูนย์นี้ยังไม่เคยรับสินค้าเข้าคลัง</p>
						<Button
							type="button"
							variant="outline"
							class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
							onclick={() => updateUrl({ all: true })}
						>
							ดูทั้งแคตตาล็อก
						</Button>
					{:else}
						<p class="text-sm font-medium text-slate-500">ไม่พบรายการที่ตรงเงื่อนไข</p>
						{#if filtersActive}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
								onclick={clearFilters}
							>
								ล้างตัวกรอง
							</Button>
						{/if}
					{/if}
				</div>
			{:else}
				<!-- Phone cards (< md) -->
				<ul class="space-y-2.5 p-3 md:hidden">
					{#each pageRows as row (row._id)}
						<li>
							<StockCard
								{row}
								{readonly}
								{offline}
								onopen={(r) => openDetail(r._id)}
								onreceive={(r) => openQuickAction('receive', r._id)}
								ondistribute={(r) => openQuickAction('distribute', r._id)}
							/>
						</li>
					{/each}
				</ul>

				<!-- Tablet / desktop table (md+): 4 cols → +status (lg) → +location (xl) -->
				<div class="hidden flex-1 overflow-x-auto md:block">
					<Table.Root class="text-sm">
						<Table.Header class="border-b border-slate-200/80 bg-slate-50">
							<Table.Row class="text-xs font-semibold text-slate-600">
								<Table.Head class="px-3 py-3 lg:px-4">รายการ</Table.Head>
								<Table.Head class="px-3 py-3 lg:px-4">
									คงเหลือ / <span class="xl:hidden">เกณฑ์</span><span class="hidden xl:inline">
										เกณฑ์สั่งเพิ่ม
									</span>
								</Table.Head>
								<Table.Head class="px-3 py-3 lg:px-4">หมดอายุเร็วสุด</Table.Head>
								<Table.Head class="hidden px-4 py-3 xl:table-cell">ที่เก็บ</Table.Head>
								<Table.Head class="hidden px-4 py-3 lg:table-cell">สถานะ</Table.Head>
								<Table.Head class="px-3 py-3 lg:px-4"
									><span class="sr-only">จัดการ</span></Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body class="divide-y divide-slate-100">
							{#each pageRows as row (row._id)}
								<StockRow
									{row}
									{readonly}
									{offline}
									onopen={(r) => openDetail(r._id)}
									onreceive={(r) => openQuickAction('receive', r._id)}
									ondistribute={(r) => openQuickAction('distribute', r._id)}
								/>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<div
					class="flex flex-col items-center justify-between gap-3 border-t border-slate-200/80 px-4 py-3 text-sm text-slate-600 sm:flex-row"
				>
					<span class="tabular-nums">
						แสดง {rangeStart}–{rangeEnd} จาก {filteredRows.length} รายการ
					</span>
					<PaginationControls
						bind:page={() => currentPage, (p) => updateUrl({ page: p })}
						count={filteredRows.length}
						perPage={STOCK_PAGE_SIZE}
					/>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Movement buttons: bottom bar below md (md+ keeps them in the header) -->
<div
	class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
>
	<Button
		type="button"
		class="min-h-12 rounded-lg bg-[#0A2647] text-sm font-semibold text-white hover:bg-[#051930]"
		disabled={offline}
		title={offline ? OFFLINE_HINT : undefined}
		onclick={() => openQuickAction('receive')}
	>
		รับเข้า
	</Button>
	<Button
		type="button"
		variant="outline"
		class="min-h-12 rounded-lg border-slate-300 text-sm font-semibold text-slate-800"
		disabled={offline}
		title={offline ? OFFLINE_HINT : undefined}
		onclick={() => openQuickAction('distribute')}
	>
		เบิกจ่าย
	</Button>
	<Button
		type="button"
		variant="outline"
		class="min-h-12 rounded-lg border-slate-300 text-sm font-semibold text-slate-800"
		disabled={offline}
		title={offline ? OFFLINE_HINT : undefined}
		onclick={() => openQuickAction('adjust')}
	>
		ตรวจนับ
	</Button>
</div>

<ItemDetailSheet
	bind:open={detailOpen}
	row={selectedManageItem}
	lots={selectedItemId ? (lotsByItem.get(selectedItemId) ?? []) : []}
	itemsById={lotPriorityItems}
	shelterCode={getShelterCode()}
	{offline}
	onaction={(kind) => openQuickAction(kind, selectedItemId ?? undefined)}
/>

<!-- Quick receive / distribute / adjust (header buttons: no preselect; row buttons: item preselected).
	Desktop: right side sheet (receive 760px, others 600px); mobile: full-height bottom sheet. -->
<Sheet.Root bind:open={quickActionOpen}>
	<Sheet.Content
		side={isMobileViewport.current ? 'bottom' : 'right'}
		class={[
			'flex flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)]',
			isMobileViewport.current
				? 'h-[100dvh] max-h-[100dvh] rounded-none'
				: [
						'h-[100dvh] w-full sm:max-w-none md:border-l',
						quickActionKind === 'receive' ? 'md:w-[47.5rem]' : 'md:w-[37.5rem]'
					]
		]}
	>
		<Sheet.Header class="shrink-0 border-b border-slate-200/80 px-4 py-4 pr-14 text-left sm:px-6">
			<Sheet.Title class="text-xl font-bold text-slate-900">
				{quickActionTitle}
			</Sheet.Title>
			<Sheet.Description class="text-sm text-slate-500">
				{quickActionDescription}
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
			{#if quickActionKind === 'receive'}
				<ReceiveStockForm preselectedItemId={quickActionItemId} onsuccess={onMovementSuccess} />
			{:else if quickActionKind === 'distribute'}
				<DistributeStockForm
					preselectedItemId={quickActionItemId}
					{occupancy}
					onsuccess={onMovementSuccess}
				/>
			{:else}
				<AdjustStockForm preselectedItemId={quickActionItemId} onsuccess={onMovementSuccess} />
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
