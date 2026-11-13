<script lang="ts">
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useItemMasters, formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { useSupplyItems } from '$lib/features/supply';
	import {
		useStockBalance,
		useLedger,
		useStoragePoints,
		lotStorageName
	} from '$lib/features/operations';
	import { useFoodSphereStandards } from '../application/food-sphere-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import { useShelterPeopleCounts } from '../application/shelter-people-queries';
	import { useReplenishmentPolicies } from '../application/replenishment-queries';
	import { headcountsFromAgeGroups } from '../domain/food-sphere-calc';
	import { useDashboardDemographics, useDashboardOccupancy } from '$lib/features/dashboard';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { canEditStockParameters, isSystemAdmin } from '$lib/auth/roles';
	import {
		buildFoodSphereTable,
		type FoodSphereTableGroup,
		type FoodSphereTableItem
	} from '../domain/food-sphere-table';
	import { InvalidStockQtyError } from '../domain/food-sphere-table';
	import { InvalidRatioQtyError } from '../domain/qty-input';
	import { toast } from 'svelte-sonner';
	import type { DocAlertStatus } from '../domain/replenishment-calc';
	import DocStatusBadge from './doc-status-badge.svelte';
	import PeopleTotalTooltip from './people-total-tooltip.svelte';
	import StockParametersSheet from './stock-parameters-sheet.svelte';
	import RequirementGroupEditSheet from './requirement-group-edit-sheet.svelte';
	import { qtyGt } from '$lib/utils/qty';

	// Icons
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Package from '@lucide/svelte/icons/package';
	import Utensils from '@lucide/svelte/icons/utensils';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Info from '@lucide/svelte/icons/info';
	import Boxes from '@lucide/svelte/icons/boxes';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Settings2 from '@lucide/svelte/icons/settings-2';

	let {
		occupancy = 0,
		shelterCode = ''
	}: {
		occupancy?: number;
		shelterCode?: string | null;
	} = $props();

	const cleanShelterCode = $derived(shelterCode || shelterStore.selectedShelterCode || '');

	// Stock parameter overrides: SA / SM / WH of this shelter (CR-235). Buttons are hidden
	// otherwise; CouchDB enforces the same rule.
	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const canEditParams = $derived(canEditStockParameters(roles, cleanShelterCode));
	let paramsSheetOpen = $state(false);
	let groupSheetOpen = $state(false);
	let editingGroupId = $state('');

	function openGroupEditor(groupId: string) {
		editingGroupId = groupId;
		groupSheetOpen = true;
	}

	// ─── Queries ──────────────────────────────────────────────────────────────
	const itemMastersQuery = useItemMasters();
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const supplyItemsQuery = useSupplyItems();
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const storagePoints = useStoragePoints(() => cleanShelterCode);
	const standardsQuery = useFoodSphereStandards(() => cleanShelterCode);
	const reqGroupsQuery = useRequirementGroups(() => cleanShelterCode);
	const policiesQuery = useReplenishmentPolicies(() => cleanShelterCode);
	const demographicsQuery = useDashboardDemographics(() => cleanShelterCode);
	const occupancyQuery = useDashboardOccupancy(() => cleanShelterCode);

	const peopleQuery = useShelterPeopleCounts(() => cleanShelterCode);
	const evacueeCount = $derived(
		peopleQuery.data?.evacuees ??
			(occupancy > 0 ? occupancy : (occupancyQuery.data?.in_shelter ?? 0))
	);
	const staffCount = $derived(peopleQuery.data?.staff ?? 0);
	const volunteerCount = $derived(peopleQuery.data?.volunteers ?? 0);
	const effectiveOccupancy = $derived(evacueeCount + staffCount + volunteerCount);
	const peopleBaseFailed = $derived(peopleQuery.isError);

	const isLoading = $derived(
		itemMastersQuery.isLoading ||
			supplyItemsQuery.isLoading ||
			balanceQuery.isLoading ||
			ledgerQuery.isLoading ||
			standardsQuery.isLoading ||
			reqGroupsQuery.isLoading ||
			policiesQuery.isLoading
	);

	// ─── Filters & Search State ───────────────────────────────────────────────
	let searchQuery = $state('');
	let categoryFilter = $state<string>('ALL_GROUPS');
	let riskFilter = $state<'ALL' | DocAlertStatus>('ALL');

	// Accordion open/close state: group IDs that are expanded
	const expandedGroupIds = new SvelteSet<string>();
	let initializedGroups = $state(false);

	// Latest lot info derived from ledger
	const latestLotInfo = $derived.by(() => {
		const ledger = ledgerQuery.data ?? [];
		const result: Record<string, { expiry?: string; note?: string }> = {};
		const sorted = [...ledger].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
		for (const entry of sorted) {
			// `note` here is the lot's storage location label (draft-shelter-storage-points).
			const location = lotStorageName(entry.lot, storagePoints.points) ?? undefined;
			if (qtyGt(entry.qty, 0) && (entry.lot?.expiry || location)) {
				result[entry.item_id] = { expiry: entry.lot?.expiry, note: location };
			}
		}
		return result;
	});

	// Merged item list
	const allItems = $derived.by(() => {
		const itemMasters = itemMastersQuery.data ?? [];
		const supplyItems = (supplyItemsQuery.data ?? []).map((si) => ({
			_id: si._id,
			name: si.name,
			category: si.category || 'other',
			sku: si._id,
			base_unit: si.unit || 'piece',
			unit: si.unit || 'piece'
		}));

		const map = new SvelteMap<
			string,
			{
				_id: string;
				name: string;
				category?: string;
				sku?: string;
				base_unit?: string;
				unit?: string;
			}
		>();

		for (const im of itemMasters) {
			map.set(im._id, {
				_id: im._id,
				name: im.name,
				category: im.category,
				sku: im.sku,
				base_unit: im.base_unit || 'piece',
				unit: im.base_unit || 'piece'
			});
		}

		for (const si of supplyItems) {
			if (!map.has(si._id)) {
				map.set(si._id, si);
			}
		}

		return Array.from(map.values());
	});

	// Build raw table calculation
	const tableData = $derived.by(() => {
		const balance = balanceQuery.data ?? new Map<string, string>();
		const reqGroups = reqGroupsQuery.data ?? [];
		const standards = standardsQuery.data ?? [];
		const policies = policiesQuery.data ?? [];
		const demographics = demographicsQuery.data;

		const headcounts = headcountsFromAgeGroups(effectiveOccupancy, demographics?.age_groups);

		try {
			if (standardsQuery.error instanceof InvalidRatioQtyError) throw standardsQuery.error;
			if (reqGroupsQuery.error instanceof InvalidRatioQtyError) throw reqGroupsQuery.error;
			return {
				error: null as string | null,
				...buildFoodSphereTable({
					itemMasters: allItems,
					balance,
					requirementGroups: reqGroups,
					standards,
					policies,
					headcounts,
					latestLotInfo
				})
			};
		} catch (e) {
			if (!(e instanceof InvalidStockQtyError) && !(e instanceof InvalidRatioQtyError)) throw e;
			return {
				error:
					e instanceof InvalidRatioQtyError
						? e.message
						: `ข้อมูลสต็อกของ ${allItems.find((i) => i._id === e.itemId)?.name ?? e.itemId} อ่านค่าไม่ได้`,
				groups: [] as FoodSphereTableGroup[],
				summary: {
					totalItems: 0,
					criticalCount: 0,
					warningCount: 0,
					adequateCount: 0,
					overstockCount: 0,
					unconfiguredCount: 0
				}
			};
		}
	});

	// Toast once per distinct error message, not on every recompute.
	let lastErrorShown: string | null = null;
	$effect(() => {
		const message = tableData.error;
		if (message !== lastErrorShown) {
			lastErrorShown = message;
			if (message) toast.error(message);
		}
	});

	// Auto-expand all groups upon first load
	$effect(() => {
		if (!initializedGroups && tableData.groups.length > 0) {
			for (const g of tableData.groups) {
				expandedGroupIds.add(g.id);
			}
			initializedGroups = true;
		}
	});

	// Filtered groups and items
	const filteredGroups = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();

		return tableData.groups
			.map((group) => {
				// Filter by category dropdown
				if (categoryFilter !== 'ALL_GROUPS' && group.id !== categoryFilter) {
					return null;
				}

				const matchingItems = group.items.filter((item) => {
					// Filter by risk status dropdown
					if (riskFilter !== 'ALL' && item.status !== riskFilter) {
						return false;
					}

					// Filter by search query (item name, SKU, item ID, or group name)
					if (q) {
						const matchName = item.name.toLowerCase().includes(q);
						const matchSku = item.sku?.toLowerCase().includes(q) ?? false;
						const matchId = item.itemId.toLowerCase().includes(q);
						const matchGroup = group.name.toLowerCase().includes(q);
						return matchName || matchSku || matchId || matchGroup;
					}

					return true;
				});

				if (matchingItems.length === 0) {
					return null;
				}

				return {
					...group,
					items: matchingItems
				};
			})
			.filter((g): g is FoodSphereTableGroup => g !== null);
	});

	// If search query is active, auto-expand groups that have matches
	$effect(() => {
		if (searchQuery.trim().length > 0) {
			for (const g of filteredGroups) {
				expandedGroupIds.add(g.id);
			}
		}
	});

	function toggleGroup(groupId: string) {
		if (expandedGroupIds.has(groupId)) {
			expandedGroupIds.delete(groupId);
		} else {
			expandedGroupIds.add(groupId);
		}
	}

	function expandAll() {
		for (const g of tableData.groups) {
			expandedGroupIds.add(g.id);
		}
	}

	function collapseAll() {
		expandedGroupIds.clear();
	}

	function clearFilters() {
		searchQuery = '';
		categoryFilter = 'ALL_GROUPS';
		riskFilter = 'ALL';
	}

	function formatDemand(val: number): string {
		if (val <= 0) return '0.0';
		return val.toLocaleString('th-TH', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 2
		});
	}

	function formatStock(val: number): string {
		return val.toLocaleString('th-TH', {
			maximumFractionDigits: 2
		});
	}

	function getStatusExplanation(item: FoodSphereTableItem): string {
		if (item.status === 'UNCONFIGURED') {
			if (item.itemDailyDemand <= 0) return 'ไม่มีข้อมูลอัตราการใช้ต่อวัน';
			return 'ยังไม่ได้ตั้งนโยบายเติมสต็อก';
		}
		if (item.status === 'CRITICAL') {
			if (item.docDays === 0) return 'ของหมดแล้ว';
			return 'น้อยกว่าเวลารอที่กำหนด หาของตอนนี้อาจไม่ทัน';
		}
		if (item.status === 'WARNING_REORDER') {
			return `จุดที่ควรจัดหาเพิ่ม (${item.reorderLevel.toFixed(1)} ${formatUnit(item.baseUom, units, langState.current)}) ควรเริ่มหาเพิ่มแล้ว`;
		}
		if (item.status === 'ADEQUATE') {
			return 'ใช้ได้นานพอ ยังไม่ต้องหาเพิ่ม';
		}
		if (item.status === 'OVERSTOCK') {
			return `เกินจำนวนวันสูงสุดที่ตั้งไว้ (${item.policy?.max_doc_days ?? 0} วัน)`;
		}
		return '';
	}

	const summaryCards = $derived([
		{
			key: 'ALL' as const,
			label: 'ของทั้งหมด',
			hint: 'รายการที่วิเคราะห์',
			count: tableData.summary.totalItems,
			icon: Boxes,
			iconClass: 'text-slate-500',
			numberClass: 'text-slate-900'
		},
		{
			key: 'CRITICAL' as const,
			label: 'เสี่ยงขาดของ',
			hint: 'เหลือใช้น้อยกว่าเวลารอที่กำหนด',
			count: tableData.summary.criticalCount,
			icon: ShieldAlert,
			iconClass: 'text-red-600',
			numberClass: 'text-red-700'
		},
		{
			key: 'WARNING_REORDER' as const,
			label: 'ควรจัดหาเพิ่ม',
			hint: 'ของเหลือถึงจุดที่ควรเริ่มหาเพิ่มแล้ว',
			count: tableData.summary.warningCount,
			icon: AlertTriangle,
			iconClass: 'text-amber-600',
			numberClass: 'text-amber-700'
		},
		{
			key: 'ADEQUATE' as const,
			label: 'เพียงพอ',
			hint: 'ใช้ได้นานพอ ยังไม่ต้องหาเพิ่ม',
			count: tableData.summary.adequateCount,
			icon: CheckCircle2,
			iconClass: 'text-emerald-600',
			numberClass: 'text-emerald-700'
		},
		{
			key: 'OVERSTOCK' as const,
			label: 'ของเกินจำเป็น',
			hint: 'มีมากกว่าจำนวนวันสูงสุดที่ตั้งไว้',
			count: tableData.summary.overstockCount,
			icon: Info,
			iconClass: 'text-sky-600',
			numberClass: 'text-sky-700'
		},
		{
			key: 'UNCONFIGURED' as const,
			label: 'ยังไม่ตั้งนโยบาย',
			hint: 'ตั้งที่แท็บ นโยบายการเติมสต็อก',
			count: tableData.summary.unconfiguredCount,
			icon: AlertCircle,
			iconClass: 'text-slate-500',
			numberClass: 'text-slate-600'
		}
	]);
</script>

{#snippet peopleTotal()}
	<PeopleTotalTooltip
		total={effectiveOccupancy}
		evacuees={evacueeCount}
		staff={staffCount}
		volunteers={volunteerCount}
		failed={peopleBaseFailed}
	/>
{/snippet}

<div class="space-y-4">
	<!-- Header + CTAs (same pattern as the stock table) -->
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<h2 class="text-lg font-bold text-slate-900 sm:text-xl">วิเคราะห์เสบียงอาหาร</h2>
		<div class="flex flex-wrap gap-2 md:justify-end">
			{#if canEditParams}
				<Button
					type="button"
					class="min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930]"
					onclick={() => (paramsSheetOpen = true)}
				>
					<Settings2 class="h-4 w-4" aria-hidden="true" />
					ตั้งค่าพารามิเตอร์
				</Button>
			{/if}
			<Button
				type="button"
				variant="outline"
				class="min-h-11 rounded-lg border-slate-300 px-4 text-sm font-semibold text-slate-800 shadow-2xs"
				onclick={expandAll}
			>
				ขยายทั้งหมด
			</Button>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 rounded-lg border-slate-300 px-4 text-sm font-semibold text-slate-800 shadow-2xs"
				onclick={collapseAll}
			>
				ย่อทั้งหมด
			</Button>
		</div>
	</div>

	{#if !tableData.error}
		<!-- Summary cards: same look as the stock page's attention cards -->
		<section
			aria-label="สรุปสถานะเสบียง"
			class="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6 xl:gap-3"
		>
			{#each summaryCards as card (card.key)}
				{@const isSelected = riskFilter === card.key}
				<button
					type="button"
					aria-pressed={isSelected}
					onclick={() => (riskFilter = isSelected && card.key !== 'ALL' ? 'ALL' : card.key)}
					class="flex min-h-[72px] flex-col items-start justify-center gap-0.5 rounded-xl px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none xl:min-h-28 xl:gap-1 xl:px-4 xl:py-3.5 {isSelected
						? 'border-2 border-[#0284C7] bg-sky-50'
						: 'border border-slate-200/80 bg-white shadow-2xs hover:border-slate-300'}"
				>
					<span class="flex w-full items-center justify-between gap-2">
						<span class="text-sm font-semibold text-slate-700">{card.label}</span>
						<card.icon class="h-4 w-4 shrink-0 {card.iconClass}" aria-hidden="true" />
					</span>
					<span class="text-2xl font-bold tabular-nums xl:text-3xl {card.numberClass}">
						{card.count}
					</span>
					<span class="text-xs text-slate-500">{card.hint}</span>
				</button>
			{/each}
		</section>
	{/if}

	<div
		class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
	>
		{#if !tableData.error}
			<!-- Filters -->
			<div
				class="grid grid-cols-2 gap-2.5 border-b border-slate-200/80 p-3 md:grid-cols-[minmax(0,2.2fr)_repeat(2,minmax(0,1fr))_auto] md:p-4"
			>
				<div class="relative col-span-2 md:col-span-1">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
						aria-hidden="true"
					/>
					<Input
						bind:value={searchQuery}
						placeholder="ค้นหา SKU, ชื่อรายการ หรือกลุ่มความต้องการ"
						aria-label="ค้นหารายการเสบียง"
						class="min-h-11 w-full rounded-lg border-slate-300 bg-white pr-10 pl-9 text-base shadow-2xs md:text-sm"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
							aria-label="ล้างคำค้นหา"
						>
							<X class="h-4 w-4" />
						</button>
					{/if}
				</div>

				<label class="flex min-w-0 items-center gap-1.5 text-sm">
					<span class="sr-only">กรองหมวดหมู่</span>
					<select
						bind:value={categoryFilter}
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<option value="ALL_GROUPS">หมวด: ทั้งหมด ({tableData.groups.length} กลุ่ม)</option>
						{#each tableData.groups as g (g.id)}
							<option value={g.id}>หมวด: {g.name} ({g.items.length})</option>
						{/each}
					</select>
				</label>

				<label class="flex min-w-0 items-center gap-1.5 text-sm">
					<span class="sr-only">กรองสถานะ</span>
					<select
						bind:value={riskFilter}
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<option value="ALL">สถานะ: ทั้งหมด ({tableData.summary.totalItems})</option>
						<option value="CRITICAL">สถานะ: เสี่ยงขาดของ ({tableData.summary.criticalCount})</option
						>
						<option value="WARNING_REORDER">
							สถานะ: ควรจัดหาเพิ่ม ({tableData.summary.warningCount})
						</option>
						<option value="ADEQUATE">สถานะ: เพียงพอ ({tableData.summary.adequateCount})</option>
						<option value="OVERSTOCK"
							>สถานะ: ของเกินจำเป็น ({tableData.summary.overstockCount})</option
						>
						<option value="UNCONFIGURED">
							สถานะ: ยังไม่ตั้งนโยบาย ({tableData.summary.unconfiguredCount})
						</option>
					</select>
				</label>

				{#if searchQuery || categoryFilter !== 'ALL_GROUPS' || riskFilter !== 'ALL'}
					<button
						type="button"
						onclick={clearFilters}
						class="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-sky-800 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none md:col-span-1"
					>
						<RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
						ล้างตัวกรอง
					</button>
				{/if}
			</div>

			<p
				class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600"
			>
				<span>
					กำลังแสดง <strong class="font-semibold text-slate-900 tabular-nums">
						{filteredGroups.reduce((acc, g) => acc + g.items.length, 0)}
					</strong>
					รายการใน {filteredGroups.length} กลุ่ม
				</span>
				{#if effectiveOccupancy > 0}
					<span aria-hidden="true" class="text-slate-400">·</span>
					{@render peopleTotal()}
				{/if}
				{#if peopleBaseFailed}
					<span class="font-semibold text-red-700">
						· โหลดจำนวนเจ้าหน้าที่และจิตอาสาไม่สำเร็จ ฐานคำนวณนี้ต่ำกว่าความเป็นจริง
					</span>
				{/if}
			</p>
		{/if}

		<!-- Table / Content Area -->
		{#if isLoading}
			<div
				class="flex-1 space-y-3 p-4"
				role="status"
				aria-label="กำลังโหลดข้อมูลการวิเคราะห์เสบียงอาหาร"
			>
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"></div>
				{/each}
			</div>
		{:else if tableData.error}
			<div
				role="alert"
				class="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-6 text-center text-sm font-medium text-destructive sm:p-8"
			>
				{tableData.error}
			</div>
		{:else if filteredGroups.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
				<Boxes class="h-12 w-12 text-slate-300" aria-hidden="true" />
				<p class="text-sm font-medium text-slate-500">ไม่พบรายการเสบียงตามเงื่อนไขที่เลือก</p>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
					onclick={clearFilters}
				>
					ล้างตัวกรอง
				</Button>
			</div>
		{:else}
			<div class="divide-y divide-slate-200/80">
				{#each filteredGroups as group (group.id)}
					{@const isExpanded = expandedGroupIds.has(group.id)}
					<div>
						<!-- Group Accordion Header (edit button is a sibling: no button inside a button) -->
						<div class="flex items-center bg-slate-50 transition-colors hover:bg-slate-100">
							<button
								type="button"
								onclick={() => toggleGroup(group.id)}
								class="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2.5 px-3.5 py-3 text-left focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset sm:px-5"
							>
								<div class="flex min-w-0 items-center gap-2.5 sm:gap-3">
									<div
										class="shrink-0 rounded-lg border border-slate-200 bg-white p-1 text-slate-500 shadow-2xs"
									>
										{#if isExpanded}
											<ChevronDown class="h-4 w-4 text-[#0A2647]" />
										{:else}
											<ChevronRight class="h-4 w-4" />
										{/if}
									</div>

									<div class="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
										<span class="text-sm font-bold break-words text-slate-900 sm:text-base">
											{group.name}
										</span>
										<span
											class="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
										>
											{group.items.length} รายการ
										</span>
										{#if group.totalGroupDemand > 0}
											<span
												class="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-medium text-slate-600"
											>
												เป้าหมาย: {group.totalGroupDemand.toLocaleString()}
												{formatUnit(group.standardUom, units, langState.current)}/วัน
											</span>
										{/if}
									</div>
								</div>

								<div class="hidden shrink-0 text-xs font-semibold text-slate-500 sm:block">
									{isExpanded ? 'คลิกเพื่อย่อ' : 'คลิกเพื่อขยาย'}
								</div>
							</button>
							{#if canEditParams && group.id !== 'GENERAL'}
								<Button
									variant="outline"
									size="sm"
									onclick={() => openGroupEditor(group.id)}
									aria-label={`แก้ไขกลุ่ม ${group.name}`}
									class="mr-3 min-h-11 shrink-0 gap-1 rounded-lg border-slate-300 text-sm font-semibold sm:mr-5"
								>
									<Settings2 class="h-3.5 w-3.5" />
									<span class="hidden sm:inline">แก้ไข</span>
								</Button>
							{/if}
						</div>

						<!-- Rows inside Accordion -->
						{#if isExpanded}
							<!-- Mobile View (< md screens): Touch-friendly Card List -->
							<div class="divide-y divide-slate-100 md:hidden">
								{#each group.items as item (item.itemId)}
									<div class="flex flex-col gap-2.5 p-3.5">
										<!-- Header: Icon, Name, SKU, and Status Badge -->
										<div class="flex items-start justify-between gap-2">
											<div class="flex min-w-0 items-start gap-2.5">
												<div
													class="mt-0.5 shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-1.5 text-slate-500"
												>
													{#if item.category === 'food'}
														<Utensils class="h-4 w-4 text-orange-500" />
													{:else}
														<Package class="h-4 w-4 text-blue-500" />
													{/if}
												</div>
												<div class="flex min-w-0 flex-col">
													<span class="text-sm font-bold break-words text-slate-900"
														>{item.name}</span
													>
													<div
														class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500"
													>
														{#if item.sku}
															<span class="font-mono">{item.sku}</span>
															<span>·</span>
														{/if}
														<span>หน่วย: {formatUnit(item.baseUom, units, langState.current)}</span>
														{#if item.expiryDate}
															<span>·</span>
															<span class="text-amber-600 dark:text-amber-400"
																>หมดอายุ: {item.expiryDate}</span
															>
														{/if}
													</div>
												</div>
											</div>
											<div class="shrink-0">
												<DocStatusBadge
													status={item.status}
													docDays={item.docDays}
													itemId={item.itemId}
													compact={true}
												/>
											</div>
										</div>

										<!-- Target group info -->
										<div class="flex flex-wrap items-center gap-1.5 text-xs">
											{#if item.reqGroupId !== 'GENERAL'}
												<span
													class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-900"
												>
													คำนวณ: {group.name}
													{#if item.sharePercent < 100}
														<span class="font-semibold text-sky-800">({item.sharePercent}%)</span>
													{/if}
												</span>
											{:else}
												<span
													class="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500"
												>
													รายการทั่วไป
												</span>
											{/if}
											<span class="text-[11px] text-slate-500">
												ฐานคำนวณ: {@render peopleTotal()}
											</span>
										</div>

										<!-- Key metric blocks -->
										<div
											class="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2 text-center"
										>
											<div class="flex flex-col justify-center">
												<span class="text-[10px] font-medium text-slate-500">เป้าหมาย/วัน</span>
												<span class="font-mono text-xs font-bold text-slate-900">
													{formatDemand(item.itemDailyDemand)}
												</span>
												<span class="text-[9px] text-slate-500"
													>{formatUnit(item.baseUom, units, langState.current)}</span
												>
											</div>
											<div class="flex flex-col justify-center border-l border-slate-100 px-1">
												<span class="text-[10px] font-medium text-slate-500">คงเหลือ</span>
												<span class="font-mono text-xs font-bold text-slate-900">
													{formatStock(item.physicalStock)}
												</span>
												<span class="text-[9px] text-slate-500"
													>{formatUnit(item.baseUom, units, langState.current)}</span
												>
											</div>
										</div>

										<!-- Explanation footer -->
										{#if getStatusExplanation(item)}
											<div
												class="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500"
											>
												<span>{getStatusExplanation(item)}</span>
												{#if item.conversionFactor > 1}
													<span class="text-[10px] text-slate-500/80">
														1 {formatUnit(item.baseUom, units, langState.current)} = {item.conversionFactor}
														{formatUnit(group.standardUom, units, langState.current)}
													</span>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>

							<!-- Desktop Table View (>= md screens) with safe overflow scrolling -->
							<div class="hidden overflow-x-auto md:block">
								<table class="w-full min-w-[920px] text-left text-sm">
									<thead
										class="border-b border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-600"
									>
										<tr>
											<th class="w-[28%] max-w-[320px] min-w-[220px] p-3.5 pl-5">
												หมวดหมู่ / รายการพัสดุ
											</th>
											<th class="w-[18%] max-w-[220px] min-w-[160px] p-3.5">
												กลุ่มเป้าหมาย &amp; จำนวนคน
											</th>
											<th class="w-[13%] max-w-[160px] min-w-[120px] p-3.5 text-right">
												เป้าหมายรายวัน
											</th>
											<th class="w-[16%] max-w-[180px] min-w-[120px] p-3.5 text-right">คงเหลือ</th>
											<th class="w-[18%] max-w-[280px] min-w-[210px] p-3.5 pr-5 text-right">
												ใช้ได้อีก (วัน)
											</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-100">
										{#each group.items as item (item.itemId)}
											<tr class="transition-colors hover:bg-slate-50">
												<!-- Col 1: Item info (with width constraints) -->
												<td class="max-w-[320px] min-w-[220px] p-3.5 pl-5">
													<div class="flex items-start gap-3">
														<div
															class="mt-0.5 shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-1.5 text-slate-500"
														>
															{#if item.category === 'food'}
																<Utensils class="h-4 w-4 text-orange-500" />
															{:else}
																<Package class="h-4 w-4 text-blue-500" />
															{/if}
														</div>
														<div class="flex min-w-0 flex-col">
															<span class="font-bold break-words text-slate-900" title={item.name}>
																{item.name}
															</span>
															<div
																class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500"
															>
																{#if item.sku}
																	<span class="font-mono">{item.sku}</span>
																	<span>·</span>
																{/if}
																<span
																	>หน่วย: {formatUnit(item.baseUom, units, langState.current)}</span
																>
																{#if item.expiryDate}
																	<span>·</span>
																	<span class="text-amber-600 dark:text-amber-400"
																		>หมดอายุ: {item.expiryDate}</span
																	>
																{/if}
															</div>
														</div>
													</div>
												</td>

												<!-- Col 2: Target segment & Headcount (with width constraints) -->
												<td class="max-w-[220px] min-w-[160px] p-3.5">
													<div class="flex flex-col gap-1">
														{#if item.reqGroupId !== 'GENERAL'}
															<span
																class="inline-flex max-w-fit items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-900"
															>
																กลุ่มคำนวณ: {group.name}
																{#if item.sharePercent < 100}
																	<span class="font-semibold text-sky-800"
																		>({item.sharePercent}%)</span
																	>
																{/if}
															</span>
														{:else}
															<span
																class="inline-flex max-w-fit items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500"
															>
																รายการทั่วไป (ยังไม่ผูกกลุ่ม)
															</span>
														{/if}
														<span class="text-[11px] text-slate-500">
															ฐานคำนวณ: {@render peopleTotal()}
														</span>
													</div>
												</td>

												<!-- Col 3: Daily demand target (with width constraints) -->
												<td
													class="max-w-[160px] min-w-[120px] p-3.5 text-right font-mono font-bold whitespace-nowrap text-slate-900"
												>
													<div>
														{formatDemand(item.itemDailyDemand)}
														<span class="text-xs font-normal text-slate-500">
															{formatUnit(item.baseUom, units, langState.current)}/วัน
														</span>
													</div>
													{#if item.conversionFactor > 1}
														<div class="text-[10px] font-normal text-slate-500">
															ตัวแปลง: 1 {formatUnit(item.baseUom, units, langState.current)} = {item.conversionFactor}
															{formatUnit(group.standardUom, units, langState.current)}
														</div>
													{/if}
												</td>

												<!-- Col 4: On-hand -->
												<td
													class="max-w-[180px] min-w-[120px] p-3.5 text-right font-mono font-bold whitespace-nowrap text-slate-900"
												>
													{formatStock(item.physicalStock)}
													<span class="text-xs font-normal text-slate-500">
														{formatUnit(item.baseUom, units, langState.current)}
													</span>
												</td>

												<!-- Col 5: Days of cover & Status Badge (with width constraints) -->
												<td class="max-w-[280px] min-w-[210px] p-3.5 pr-5 text-right">
													<div class="flex flex-col items-end gap-1">
														<DocStatusBadge
															status={item.status}
															docDays={item.docDays}
															itemId={item.itemId}
															compact={true}
														/>
														<span
															class="text-[11px] whitespace-nowrap text-slate-500"
															title={getStatusExplanation(item)}
														>
															{getStatusExplanation(item)}
														</span>
													</div>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
{#if canEditParams && cleanShelterCode}
	<StockParametersSheet bind:open={paramsSheetOpen} shelterCode={cleanShelterCode} {isSA} canEdit />
	<RequirementGroupEditSheet
		bind:open={groupSheetOpen}
		shelterCode={cleanShelterCode}
		groupId={editingGroupId}
	/>
{/if}
