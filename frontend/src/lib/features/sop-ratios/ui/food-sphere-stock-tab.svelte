<script lang="ts">
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useItemMasters } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { useStockBalance, useLedger } from '$lib/features/operations';
	import { useFoodSphereStandards } from '../application/food-sphere-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import { useReplenishmentPolicies } from '../application/replenishment-queries';
	import { useDashboardDemographics, useDashboardOccupancy } from '$lib/features/dashboard';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		buildFoodSphereTable,
		type FoodSphereTableGroup,
		type FoodSphereTableItem
	} from '../domain/food-sphere-table';
	import type { DocAlertStatus } from '../domain/replenishment-calc';
	import DocStatusBadge from './doc-status-badge.svelte';
	import { qtyGt } from '$lib/utils/qty';

	// Icons
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Filter from '@lucide/svelte/icons/filter';
	import Package from '@lucide/svelte/icons/package';
	import Utensils from '@lucide/svelte/icons/utensils';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Info from '@lucide/svelte/icons/info';
	import Boxes from '@lucide/svelte/icons/boxes';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

	let {
		occupancy = 0,
		shelterCode = ''
	}: {
		occupancy?: number;
		shelterCode?: string | null;
	} = $props();

	const cleanShelterCode = $derived(shelterCode || shelterStore.selectedShelterCode || '');

	// ─── Queries ──────────────────────────────────────────────────────────────
	const itemMastersQuery = useItemMasters();
	const supplyItemsQuery = useSupplyItems();
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const standardsQuery = useFoodSphereStandards(() => cleanShelterCode);
	const reqGroupsQuery = useRequirementGroups(() => cleanShelterCode);
	const policiesQuery = useReplenishmentPolicies(() => cleanShelterCode);
	const demographicsQuery = useDashboardDemographics(() => cleanShelterCode);
	const occupancyQuery = useDashboardOccupancy(() => cleanShelterCode);

	const effectiveOccupancy = $derived(
		occupancy > 0 ? occupancy : (occupancyQuery.data?.active ?? 0)
	);

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
			if (qtyGt(entry.qty, 0) && (entry.lot?.expiry || entry.lot?.note)) {
				result[entry.item_id] = {
					expiry: entry.lot?.expiry,
					note: entry.lot?.note
				};
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
			base_unit: si.unit || 'ชิ้น',
			unit: si.unit || 'ชิ้น'
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
				base_unit: im.base_unit || im.unit || 'ชิ้น',
				unit: im.unit || im.base_unit || 'ชิ้น'
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

		const headcounts: Record<string, number> = {
			ALL: effectiveOccupancy
		};
		if (demographics?.age_groups) {
			headcounts.ELDERLY = demographics.age_groups['60+'] ?? 0;
			headcounts.CHILD_2_5 = demographics.age_groups['0-4'] ?? 0;
		}

		return buildFoodSphereTable({
			itemMasters: allItems,
			balance,
			requirementGroups: reqGroups,
			standards,
			policies,
			headcounts,
			latestLotInfo
		});
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
			return 'ยังไม่ได้ผูกนโยบายสั่งเติม';
		}
		if (item.status === 'CRITICAL') {
			if (item.docDays === 0) return 'ของหมดสต็อกทันที (0 วัน)';
			return `สต็อกพอใช้เพียง ${item.docDays?.toFixed(1)} วัน (น้อยกว่าระยะเวลารอของ)`;
		}
		if (item.status === 'WARNING_REORDER') {
			return `จุดสั่งเติม (${item.reorderLevel.toFixed(1)} ${item.baseUom}) ควรเริ่มทำเรื่องเบิก`;
		}
		if (item.status === 'ADEQUATE') {
			return `สต็อกเพียงพอสำหรับ ${item.docDays?.toFixed(1)} วัน`;
		}
		if (item.status === 'OVERSTOCK') {
			return `สต็อกเกินเกณฑ์สูงสุด (${item.policy?.max_doc_days ?? 0} วัน)`;
		}
		return '';
	}
</script>

<div class="space-y-6">
	<!-- Summary KPI Cards -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
		<button
			type="button"
			onclick={() => {
				riskFilter = 'ALL';
			}}
			class="flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all hover:border-primary/50 {riskFilter ===
			'ALL'
				? 'border-primary bg-primary/5 shadow-sm'
				: 'border-border/60 bg-card/60'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-muted-foreground">พัสดุทั้งหมด</span>
				<Boxes class="h-4 w-4 text-muted-foreground" />
			</div>
			<div class="text-2xl font-bold tracking-tight text-foreground">
				{tableData.summary.totalItems}
			</div>
			<span class="text-[11px] text-muted-foreground">รายการ</span>
		</button>

		<button
			type="button"
			onclick={() => {
				riskFilter = 'CRITICAL';
			}}
			class="flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all hover:border-danger/50 {riskFilter ===
			'CRITICAL'
				? 'border-danger bg-danger/10 shadow-sm'
				: 'border-border/60 bg-card/60'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-danger">สต็อกวิกฤต</span>
				<ShieldAlert class="h-4 w-4 animate-pulse text-danger" />
			</div>
			<div class="text-2xl font-bold tracking-tight text-danger">
				{tableData.summary.criticalCount}
			</div>
			<span class="text-[11px] text-danger/80">เสี่ยงของขาด</span>
		</button>

		<button
			type="button"
			onclick={() => {
				riskFilter = 'WARNING_REORDER';
			}}
			class="flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all hover:border-warning/50 {riskFilter ===
			'WARNING_REORDER'
				? 'border-warning bg-warning/10 shadow-sm'
				: 'border-border/60 bg-card/60'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-warning-dark dark:text-warning">ถึงจุดสั่งเติม</span
				>
				<AlertTriangle class="h-4 w-4 text-warning" />
			</div>
			<div class="text-2xl font-bold tracking-tight text-warning-dark dark:text-warning">
				{tableData.summary.warningCount}
			</div>
			<span class="text-[11px] text-warning-dark/80 dark:text-warning/80">ถึงเกณฑ์สั่งเติม</span>
		</button>

		<button
			type="button"
			onclick={() => {
				riskFilter = 'ADEQUATE';
			}}
			class="flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all hover:border-success/50 {riskFilter ===
			'ADEQUATE'
				? 'border-success bg-success/10 shadow-sm'
				: 'border-border/60 bg-card/60'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-success-dark dark:text-success">สต็อกปลอดภัย</span>
				<CheckCircle2 class="h-4 w-4 text-success" />
			</div>
			<div class="text-2xl font-bold tracking-tight text-success-dark dark:text-success">
				{tableData.summary.adequateCount}
			</div>
			<span class="text-[11px] text-success-dark/80 dark:text-success/80">เพียงพอตามแผน</span>
		</button>

		<button
			type="button"
			onclick={() => {
				riskFilter = 'OVERSTOCK';
			}}
			class="flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all hover:border-blue-500/50 {riskFilter ===
			'OVERSTOCK'
				? 'border-blue-500 bg-blue-500/10 shadow-sm'
				: 'border-border/60 bg-card/60'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-blue-600 dark:text-blue-400">สต็อกเกินเกณฑ์</span>
				<Info class="h-4 w-4 text-blue-500" />
			</div>
			<div class="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
				{tableData.summary.overstockCount}
			</div>
			<span class="text-[11px] text-blue-600/80 dark:text-blue-400/80">สต็อกเกินความจำเป็น</span>
		</button>

		<button
			type="button"
			onclick={() => {
				riskFilter = 'UNCONFIGURED';
			}}
			class="flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all hover:border-muted-foreground/50 {riskFilter ===
			'UNCONFIGURED'
				? 'border-muted-foreground bg-muted/40 shadow-sm'
				: 'border-border/60 bg-card/60'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-muted-foreground">ยังไม่ตั้งค่า</span>
				<AlertCircle class="h-4 w-4 text-muted-foreground" />
			</div>
			<div class="text-2xl font-bold tracking-tight text-muted-foreground">
				{tableData.summary.unconfiguredCount}
			</div>
			<span class="text-[11px] text-muted-foreground">ยังไม่มีนโยบาย</span>
		</button>
	</div>

	<!-- Main Card Table with Toolbar -->
	<div
		class="flex h-full min-h-[55vh] flex-col rounded-[24px] border border-border/80 bg-card/85 p-6 shadow-md backdrop-blur-xl transition-all"
	>
		<!-- Toolbar & Filters -->
		<div class="mb-6 flex flex-col gap-4">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<!-- Search -->
				<div class="relative w-full lg:max-w-md">
					<Search
						class="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={searchQuery}
						placeholder="ค้นหารหัสข้อมูล (SKU), ชื่อรายการ หรือกลุ่มความต้องการ..."
						class="rounded-xl border-border/60 bg-background/80 pr-9 pl-9.5 text-xs shadow-inner transition-all focus-visible:ring-primary/40 md:text-sm"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
							aria-label="ล้างคำค้นหา"
						>
							<X class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>

				<!-- Action Controls & Expand/Collapse -->
				<div class="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={expandAll}
						class="rounded-xl border-border/60 text-xs font-medium"
					>
						ขยายทั้งหมด
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={collapseAll}
						class="rounded-xl border-border/60 text-xs font-medium"
					>
						ยุบทั้งหมด
					</Button>
				</div>
			</div>

			<!-- Filter Selectors Bar -->
			<div class="flex flex-wrap items-center gap-3 border-t border-border/40 pt-4 text-xs">
				<div class="flex items-center gap-2">
					<Filter class="h-3.5 w-3.5 text-muted-foreground" />
					<span class="font-semibold text-muted-foreground">หมวดหมู่:</span>
					<select
						bind:value={categoryFilter}
						class="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 focus:ring-1 focus:ring-primary focus:outline-none"
					>
						<option value="ALL_GROUPS">ทุกหมวดหมู่ ({tableData.groups.length} กลุ่ม)</option>
						{#each tableData.groups as g (g.id)}
							<option value={g.id}>{g.name} ({g.items.length} รายการ)</option>
						{/each}
					</select>
				</div>

				<div class="flex items-center gap-2">
					<span class="font-semibold text-muted-foreground">สถานะความเสี่ยง:</span>
					<select
						bind:value={riskFilter}
						class="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 focus:ring-1 focus:ring-primary focus:outline-none"
					>
						<option value="ALL">ทั้งหมด ({tableData.summary.totalItems} รายการ)</option>
						<option value="CRITICAL">สต็อกวิกฤต ({tableData.summary.criticalCount})</option>
						<option value="WARNING_REORDER"
							>ถึงจุดสั่งเติม ({tableData.summary.warningCount})</option
						>
						<option value="ADEQUATE">สต็อกปลอดภัย ({tableData.summary.adequateCount})</option>
						<option value="OVERSTOCK">สต็อกเกินเกณฑ์ ({tableData.summary.overstockCount})</option>
						<option value="UNCONFIGURED"
							>ยังไม่ได้ตั้งค่านโยบาย ({tableData.summary.unconfiguredCount})</option
						>
					</select>
				</div>

				{#if searchQuery || categoryFilter !== 'ALL_GROUPS' || riskFilter !== 'ALL'}
					<button
						type="button"
						onclick={clearFilters}
						class="inline-flex items-center gap-1 rounded-lg bg-muted/80 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
					>
						<RefreshCw class="h-3 w-3" />
						ล้างตัวกรอง
					</button>
				{/if}

				<div class="ml-auto text-xs text-muted-foreground">
					แสดง {filteredGroups.reduce((acc, g) => acc + g.items.length, 0)} รายการใน {filteredGroups.length}
					กลุ่ม
					{#if effectiveOccupancy > 0}
						<span class="ml-1 font-semibold text-primary"
							>· อัตราครองเตียง {effectiveOccupancy} คน</span
						>
					{/if}
				</div>
			</div>
		</div>

		<!-- Table / Content Area -->
		{#if isLoading}
			<div class="flex min-h-[300px] flex-col items-center justify-center gap-3">
				<div
					class="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
				></div>
				<span class="text-xs font-medium text-muted-foreground"
					>กำลังโหลดข้อมูลการวิเคราะห์เสบียงอาหาร...</span
				>
			</div>
		{:else if filteredGroups.length === 0}
			<div
				class="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center"
			>
				<div class="rounded-full bg-muted/60 p-3">
					<Search class="h-6 w-6 text-muted-foreground" />
				</div>
				<h3 class="mt-3 text-base font-semibold text-foreground">
					ไม่พบรายการเสบียงตามเงื่อนไขที่เลือก
				</h3>
				<p class="mt-1 max-w-sm text-xs text-muted-foreground">
					ลองปรับเปลี่ยนคำค้นหา หรือรีเซ็ตตัวกรองหมวดหมู่และสถานะความเสี่ยงเพื่อดูข้อมูลทั้งหมด
				</p>
				<Button variant="outline" size="sm" onclick={clearFilters} class="mt-4 rounded-xl text-xs">
					ล้างตัวกรองทั้งหมด
				</Button>
			</div>
		{:else}
			<div class="space-y-4">
				{#each filteredGroups as group (group.id)}
					{@const isExpanded = expandedGroupIds.has(group.id)}
					<div
						class="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-all duration-200"
					>
						<!-- Group Accordion Header -->
						<button
							type="button"
							onclick={() => toggleGroup(group.id)}
							class="flex w-full items-center justify-between gap-3 bg-muted/40 px-4 py-3.5 text-left transition-colors hover:bg-muted/60 sm:px-5"
						>
							<div class="flex items-center gap-3">
								<div
									class="rounded-lg border border-border/60 bg-background/80 p-1 text-muted-foreground shadow-sm"
								>
									{#if isExpanded}
										<ChevronDown class="h-4 w-4 text-primary" />
									{:else}
										<ChevronRight class="h-4 w-4" />
									{/if}
								</div>

								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-bold text-foreground sm:text-base">
										{group.name}
									</span>
									<span
										class="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
									>
										{group.items.length} รายการ
									</span>
									{#if group.totalGroupDemand > 0}
										<span
											class="rounded-full border border-border/60 bg-background/80 px-2.5 py-0.5 font-mono text-xs font-medium text-muted-foreground"
										>
											เป้าหมายรวม: {group.totalGroupDemand.toLocaleString()}
											{group.standardUom}/วัน
										</span>
									{/if}
								</div>
							</div>

							<div class="text-xs font-semibold text-muted-foreground">
								{isExpanded ? 'คลิกเพื่อยุบ' : 'คลิกเพื่อเปิดดู'}
							</div>
						</button>

						<!-- Table Rows inside Accordion -->
						{#if isExpanded}
							<div class="overflow-x-auto">
								<table class="w-full text-left text-xs sm:text-sm">
									<thead
										class="border-b border-border/40 bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase"
									>
										<tr>
											<th class="p-3.5 pl-5">หมวดหมู่ / ความต้องการ</th>
											<th class="p-3.5">กลุ่มเป้าหมาย &amp; จำนวนคน</th>
											<th class="p-3.5 text-right">เป้าหมายรายวัน</th>
											<th class="p-3.5 text-right">สต็อกจริง</th>
											<th class="p-3.5 text-right font-bold text-primary">ใช้งานได้จริง</th>
											<th class="p-3.5 pr-5 text-right">ความคุ้มครอง (DoC)</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-border/40">
										{#each group.items as item (item.itemId)}
											<tr class="transition-colors hover:bg-muted/30">
												<!-- Col 1: Item info -->
												<td class="p-3.5 pl-5">
													<div class="flex items-start gap-3">
														<div
															class="mt-0.5 rounded-lg border border-border/60 bg-muted/50 p-1.5 text-muted-foreground"
														>
															{#if item.category === 'food'}
																<Utensils class="h-4 w-4 text-orange-500" />
															{:else}
																<Package class="h-4 w-4 text-blue-500" />
															{/if}
														</div>
														<div class="flex flex-col">
															<span class="font-bold text-foreground">{item.name}</span>
															<div
																class="flex items-center gap-1.5 text-[11px] text-muted-foreground"
															>
																{#if item.sku}
																	<span class="font-mono">{item.sku}</span>
																	<span>·</span>
																{/if}
																<span>หน่วย: {item.baseUom}</span>
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

												<!-- Col 2: Target segment & Headcount -->
												<td class="p-3.5">
													<div class="flex flex-col gap-1">
														{#if item.reqGroupId !== 'GENERAL'}
															<span
																class="inline-flex max-w-fit items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground"
															>
																กลุ่มคำนวณ: {group.name}
																{#if item.sharePercent < 100}
																	<span class="font-semibold text-primary"
																		>({item.sharePercent}%)</span
																	>
																{/if}
															</span>
														{:else}
															<span
																class="inline-flex max-w-fit items-center rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground"
															>
																รายการทั่วไป (ยังไม่ผูกกลุ่ม)
															</span>
														{/if}
														<span class="text-[11px] text-muted-foreground">
															ผู้ประสบภัย: <strong class="text-foreground"
																>{effectiveOccupancy}</strong
															> คน
														</span>
													</div>
												</td>

												<!-- Col 3: Daily demand target -->
												<td class="p-3.5 text-right font-mono font-bold text-foreground">
													<div>
														{formatDemand(item.itemDailyDemand)}
														<span class="text-xs font-normal text-muted-foreground"
															>{item.baseUom}/วัน</span
														>
													</div>
													{#if item.conversionFactor > 1}
														<div class="text-[10px] font-normal text-muted-foreground">
															ตัวแปลง: 1 {item.baseUom} = {item.conversionFactor}
															{group.standardUom}
														</div>
													{/if}
												</td>

												<!-- Col 4: Physical On-hand -->
												<td class="p-3.5 text-right font-mono font-semibold text-foreground">
													{formatStock(item.physicalStock)}
													<span class="text-xs font-normal text-muted-foreground"
														>{item.baseUom}</span
													>
												</td>

												<!-- Col 5: Usable stock (highlighted) -->
												<td class="p-3.5 text-right font-mono font-bold text-primary">
													<span class="rounded-lg bg-primary/10 px-2 py-1">
														{formatStock(item.usableStock)}
														{item.baseUom}
													</span>
												</td>

												<!-- Col 6: DoC & Status Badge -->
												<td class="p-3.5 pr-5 text-right">
													<div class="flex flex-col items-end gap-1">
														<DocStatusBadge
															status={item.status}
															docDays={item.docDays}
															itemId={item.itemId}
															compact={false}
														/>
														<span class="text-[11px] text-muted-foreground">
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
