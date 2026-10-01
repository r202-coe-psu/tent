<script lang="ts">
	import { resolve } from '$app/paths';
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
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import LedgerTable from './ledger-table.svelte';
	import ReceiveStockForm from './receive-stock-form.svelte';
	import DistributeStockForm from './distribute-stock-form.svelte';
	import AdjustStockForm from './adjust-stock-form.svelte';
	import {
		projectStockLotBalances,
		StockLotIntegrityError,
		type StockLot
	} from '../domain/operations';
	import { formatItemAgeLine, summarizeItemLotAge } from '../domain/lot-age';
	import { lotStorageKey, lotStorageName } from '../domain/lot-storage';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import MinusCircle from '@lucide/svelte/icons/minus-circle';
	import Settings from '@lucide/svelte/icons/settings';
	import { qtyGt, qtyLte, addQty } from '$lib/utils/qty';
	import { calculateReorderLevel } from '$lib/features/supply/domain/threshold-calc';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Filter from '@lucide/svelte/icons/filter';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Activity from '@lucide/svelte/icons/activity';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

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

	let searchQuery = $state('');
	let categoryFilter = $state<string>('all');
	let locationFilter = $state<string | 'all'>('all');
	let statusFilter = $state<'all' | 'normal' | 'low' | 'empty' | 'expiring' | 'expired'>('all');

	const PAGE_SIZE = 10;
	let currentPage = $state(1);

	$effect(() => {
		void [searchQuery, categoryFilter, locationFilter, statusFilter, showOverall];
		currentPage = 1;
	});

	let selectedItemId = $state<string | null>(null);
	let isManageModalOpen = $state(false);
	let activeModalTab = $state<'history' | 'checkin' | 'distribute' | 'adjust'>('checkin');
	let quickActionOpen = $state(false);
	let quickActionKind = $state<'receive' | 'distribute' | 'adjust'>('receive');
	const isMobileViewport = new IsMobile();

	function openManage(itemId: string, tab: typeof activeModalTab = 'checkin') {
		selectedItemId = itemId;
		activeModalTab = tab;
		isManageModalOpen = true;
	}

	function openQuickAction(kind: 'receive' | 'distribute' | 'adjust') {
		quickActionKind = kind;
		quickActionOpen = true;
	}

	function onMovementSuccess() {
		// Keep overlay/panel open for the next line — forms reset themselves.
	}

	const quickActionTitle = $derived(
		quickActionKind === 'receive'
			? 'รับเข้า'
			: quickActionKind === 'distribute'
				? 'เบิกจ่าย'
				: 'ปรับปรุง'
	);
	const quickActionDescription = $derived(
		quickActionKind === 'receive'
			? 'บันทึกรับพัสดุเข้าคลัง'
			: quickActionKind === 'distribute'
				? 'บันทึกเบิกจ่ายพัสดุออกจากคลัง'
				: 'ปรับยอดสต็อกในคลัง'
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
		return Array.from(locations, ([key, label]) => ({ key, label }));
	});

	const latestLotByItem = $derived.by(() => {
		const result: Record<string, { expiry?: string; lot?: StockLot; location: string | null }> = {};
		const sorted = [...ledger].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
		for (const entry of sorted) {
			const location = lotStorageName(entry.lot, storagePoints.points);
			if (qtyGt(entry.qty, 0) && (entry.lot?.expiry || location)) {
				result[entry.item_id] = { expiry: entry.lot?.expiry, lot: entry.lot, location };
			}
		}
		return result;
	});

	const ageLineByItem = $derived.by(() => {
		const result = new SvelteMap<string, string>();
		try {
			const balances = projectStockLotBalances(ledger);
			const byItem = new SvelteMap<string, typeof balances>();
			for (const bal of balances) {
				const list = byItem.get(bal.item_id) ?? [];
				list.push(bal);
				byItem.set(bal.item_id, list);
			}
			for (const [itemId, lots] of byItem) {
				const line = formatItemAgeLine(summarizeItemLotAge(lots));
				if (line) result.set(itemId, line);
			}
		} catch (error) {
			if (!(error instanceof StockLotIntegrityError)) throw error;
		}
		return result;
	});

	function isExpiringSoon(expiryStr: string | undefined, days = 7): boolean {
		if (!expiryStr) return false;
		const exp = Date.parse(expiryStr);
		if (Number.isNaN(exp)) return false;
		return exp - Date.now() <= days * 86_400_000 && exp > Date.now();
	}

	function isExpired(expiryStr: string | undefined): boolean {
		if (!expiryStr) return false;
		const exp = Date.parse(expiryStr);
		return !Number.isNaN(exp) && exp <= Date.now();
	}

	let { occupancy = 120 } = $props();

	const itemsWithCalculatedStatus = $derived(
		items.map((item) => {
			const qtyOnHand = balance.get(item._id) ?? '0';
			const itemOverride = overrides.find((o) => o.item_id === item._id);

			let reorderThreshold: string | null = null;

			if (itemOverride) {
				if (itemOverride.consumption_rate && itemOverride.target_reserve_days) {
					reorderThreshold = calculateReorderLevel(occupancy, {
						consumption_rate: itemOverride.consumption_rate,
						target_reserve_days: itemOverride.target_reserve_days,
						timeframe: item.timeframe || 'daily'
					});
				} else if (itemOverride.reorder_level !== null) {
					reorderThreshold = String(itemOverride.reorder_level);
				}
			}

			if (reorderThreshold === null) {
				reorderThreshold = calculateReorderLevel(occupancy, item);
			}

			if (reorderThreshold === null && item.reorder_level !== null) {
				reorderThreshold = String(item.reorder_level);
			}

			let status: 'normal' | 'low' | 'empty' = 'normal';

			if (qtyLte(qtyOnHand, 0)) {
				status = 'empty';
			} else if (reorderThreshold !== null && qtyLte(qtyOnHand, reorderThreshold)) {
				status = 'low';
			}

			return {
				...item,
				qtyOnHand,
				reorderThreshold,
				status
			};
		})
	);

	const displayedItems = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		return itemsWithCalculatedStatus.filter((item) => {
			if (q && !item.name.toLowerCase().includes(q) && !item._id.toLowerCase().includes(q))
				return false;
			if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

			const lot = latestLotByItem[item._id];
			const expired = isExpired(lot?.expiry);
			const expiring = isExpiringSoon(lot?.expiry);

			if (locationFilter !== 'all') {
				if (!lot?.location || lotStorageKey(lot.lot) !== locationFilter) return false;
			}

			if (statusFilter !== 'all') {
				if (statusFilter === 'normal' && item.status !== 'normal') return false;
				if (statusFilter === 'low' && item.status !== 'low') return false;
				if (statusFilter === 'empty' && item.status !== 'empty') return false;
				if (statusFilter === 'expired' && !expired) return false;
				if (statusFilter === 'expiring' && !expiring) return false;
			}
			return true;
		});
	});

	const paginatedItems = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return displayedItems.slice(start, start + PAGE_SIZE);
	});

	const totalPages = $derived(Math.max(1, Math.ceil(displayedItems.length / PAGE_SIZE)));

	const isLoading = $derived(
		itemsQuery.isLoading ||
			itemMastersQuery.isLoading ||
			overridesQuery.isLoading ||
			(isSA && showOverall
				? crossBalanceQuery.isLoading || crossLedgerQuery.isLoading
				: balanceQuery.isLoading || ledgerQuery.isLoading)
	);

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

	const statusCounts = $derived.by(() => {
		let low = 0;
		let empty = 0;
		let expiring = 0;
		let expired = 0;
		for (const item of itemsWithCalculatedStatus) {
			if (item.status === 'low') low += 1;
			if (item.status === 'empty') empty += 1;
			const lot = latestLotByItem[item._id];
			if (isExpired(lot?.expiry)) expired += 1;
			else if (isExpiringSoon(lot?.expiry)) expiring += 1;
		}
		return {
			all: itemsWithCalculatedStatus.length,
			low,
			empty,
			expiring,
			expired
		};
	});

	type StatusChipKey = 'all' | 'low' | 'empty' | 'expiring' | 'expired';

	const statusChips: { key: StatusChipKey; label: string }[] = [
		{ key: 'all', label: 'ทั้งหมด' },
		{ key: 'low', label: 'ใกล้หมด' },
		{ key: 'empty', label: 'หมด' },
		{ key: 'expiring', label: 'ใกล้หมดอายุ' },
		{ key: 'expired', label: 'หมดอายุ' }
	];

	function chipCount(key: StatusChipKey): number {
		return statusCounts[key];
	}

	function setStatusChip(key: StatusChipKey) {
		statusFilter = key;
	}

	function resolveDisplayStatus(
		status: 'normal' | 'low' | 'empty',
		expired: boolean,
		expiring: boolean
	): { label: string; badgeClass: string } {
		if (expired) {
			return {
				label: 'หมดอายุ',
				badgeClass: 'border border-red-200 bg-red-50 text-red-900'
			};
		}
		if (status === 'empty') {
			return {
				label: 'หมด',
				badgeClass: 'border border-red-200 bg-red-50 text-red-900'
			};
		}
		if (status === 'low') {
			return {
				label: 'ใกล้หมด',
				badgeClass: 'border border-amber-200 bg-amber-50 text-amber-900'
			};
		}
		if (expiring) {
			return {
				label: 'ใกล้หมดอายุ',
				badgeClass: 'border border-amber-200 bg-amber-50 text-amber-900'
			};
		}
		return {
			label: 'ปกติ',
			badgeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-900'
		};
	}

	const categoryTriggerLabel = $derived(
		categoryFilter === 'all' ? 'หมวด: ทั้งหมด' : `หมวด: ${getCategoryLabel(categoryFilter)}`
	);

	const statusTriggerLabel = $derived.by(() => {
		switch (statusFilter) {
			case 'normal':
				return 'สถานะ: ปกติ';
			case 'low':
				return 'สถานะ: ใกล้หมด';
			case 'empty':
				return 'สถานะ: หมด';
			case 'expiring':
				return 'สถานะ: ใกล้หมดอายุ';
			case 'expired':
				return 'สถานะ: หมดอายุ';
			default:
				return 'สถานะ: ทั้งหมด';
		}
	});

	const extraFilterActive = $derived(locationFilter !== 'all' || showOverall);

	const selectedManageItem = $derived(
		selectedItemId ? itemsWithCalculatedStatus.find((i) => i._id === selectedItemId) : undefined
	);
</script>

<div class="space-y-4 sm:space-y-6">
	<div
		class="flex min-h-[55vh] flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-6"
	>
		<!-- Header + CTAs -->
		<div
			class="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:mb-5 lg:flex-row lg:items-center lg:justify-between"
		>
			<h2 class="text-lg font-bold text-slate-900 sm:text-xl">รายการพัสดุในคลัง</h2>
			<div class="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:justify-end">
				<Button
					type="button"
					class="min-h-11 gap-2 rounded-lg bg-[#0A2647] text-sm font-semibold text-white hover:bg-[#051930]"
					onclick={() => openQuickAction('receive')}
				>
					<ArrowDownToLine class="h-4 w-4" aria-hidden="true" />
					รับเข้า
				</Button>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 gap-2 rounded-lg border-slate-200 text-sm font-semibold text-slate-800 shadow-2xs"
					onclick={() => openQuickAction('distribute')}
				>
					<ArrowUpFromLine class="h-4 w-4" aria-hidden="true" />
					เบิกจ่าย
				</Button>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 gap-2 rounded-lg border-slate-200 text-sm font-semibold text-slate-800 shadow-2xs"
					onclick={() => openQuickAction('adjust')}
				>
					<SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
					ปรับปรุง
				</Button>
				<a
					href={resolve('/back-office/supply?tab=catalog&action=create' as '/back-office/supply')}
					class="col-span-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-900 shadow-2xs transition-colors hover:bg-teal-100 md:w-auto"
				>
					<Plus class="h-4 w-4" aria-hidden="true" />
					เพิ่มของใหม่
				</a>
			</div>
		</div>

		<!-- Status chips -->
		<div
			class="-mx-1 mb-4 flex scrollbar-none gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible"
			role="group"
			aria-label="สรุปสถานะสต็อก"
		>
			{#each statusChips as chip (chip.key)}
				<button
					type="button"
					onclick={() => setStatusChip(chip.key)}
					class="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold tabular-nums transition-colors {statusFilter ===
					chip.key
						? 'border-[#0284C7] bg-sky-50 text-sky-900'
						: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"
				>
					{chip.label}
					<span class="tabular-nums">{chipCount(chip.key)}</span>
				</button>
			{/each}
		</div>

		<!-- Filters -->
		<div
			class="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 sm:p-4"
		>
			<div class="relative w-full">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
					aria-hidden="true"
				/>
				<Input
					type="text"
					placeholder="ค้นหาชื่อ / SKU…"
					bind:value={searchQuery}
					class="min-h-11 w-full rounded-lg border-slate-200 bg-white pl-9 text-base shadow-2xs sm:text-sm"
					aria-label="ค้นหาชื่อหรือ SKU"
				/>
			</div>

			<div
				class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-center"
			>
				<Select.Root
					type="single"
					value={categoryFilter}
					onValueChange={(v) => {
						if (v) categoryFilter = v;
					}}
				>
					<Select.Trigger
						class="min-h-11 w-full rounded-lg border-slate-200 bg-white text-sm font-semibold shadow-2xs"
						aria-label="กรองหมวดหมู่"
					>
						<span class="inline-flex items-center gap-2 truncate">
							<Filter class="h-4 w-4 shrink-0" aria-hidden="true" />
							{categoryTriggerLabel}
						</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="ทุกหมวดหมู่">ทุกหมวดหมู่</Select.Item>
						{#each uniqueCategories as cat (cat.value)}
							<Select.Item value={cat.value} label={cat.label}>{cat.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>

				<Select.Root
					type="single"
					value={statusFilter}
					onValueChange={(v) => {
						if (
							v === 'all' ||
							v === 'normal' ||
							v === 'low' ||
							v === 'empty' ||
							v === 'expiring' ||
							v === 'expired'
						) {
							statusFilter = v;
						}
					}}
				>
					<Select.Trigger
						class="min-h-11 w-full rounded-lg border-slate-200 bg-white text-sm font-semibold shadow-2xs"
						aria-label="กรองสถานะ"
					>
						<span class="inline-flex items-center gap-2 truncate">
							<Activity class="h-4 w-4 shrink-0" aria-hidden="true" />
							{statusTriggerLabel}
						</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="ทั้งหมด">ทั้งหมด</Select.Item>
						<Select.Item value="normal" label="ปกติ">ปกติ</Select.Item>
						<Select.Item value="low" label="ใกล้หมด">ใกล้หมด</Select.Item>
						<Select.Item value="empty" label="หมด">หมด</Select.Item>
						<Select.Item value="expiring" label="ใกล้หมดอายุ">ใกล้หมดอายุ</Select.Item>
						<Select.Item value="expired" label="หมดอายุ">หมดอายุ</Select.Item>
					</Select.Content>
				</Select.Root>

				<Popover.Root>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								type="button"
								variant="outline"
								class="min-h-11 w-full gap-2 rounded-lg border-slate-200 bg-white text-sm font-semibold shadow-2xs lg:w-auto {extraFilterActive
									? 'border-sky-200 bg-sky-50 text-sky-900'
									: ''}"
							>
								ตัวกรองเพิ่ม
								<ChevronDown class="h-4 w-4 opacity-60" aria-hidden="true" />
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-72 space-y-4 p-4" align="end">
						<div class="space-y-2">
							<Label for="stock-location-filter" class="text-sm font-semibold text-slate-700">
								ที่เก็บ
							</Label>
							<Select.Root
								type="single"
								value={locationFilter}
								onValueChange={(v) => {
									if (v) locationFilter = v;
								}}
							>
								<Select.Trigger
									id="stock-location-filter"
									class="min-h-11 w-full rounded-lg border-slate-200 bg-white text-sm"
								>
									<span class="inline-flex items-center gap-2 truncate">
										<MapPin class="h-4 w-4 shrink-0" aria-hidden="true" />
										{locationFilter === 'all'
											? 'ทุกที่เก็บ'
											: (uniqueLocations.find((l) => l.key === locationFilter)?.label ??
												locationFilter)}
									</span>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="all" label="ทุกที่เก็บ">ทุกที่เก็บ</Select.Item>
									{#each uniqueLocations as loc (loc.key)}
										<Select.Item value={loc.key} label={loc.label}>{loc.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						{#if isSA}
							<div class="flex items-start gap-3">
								<Checkbox id="show-overall" bind:checked={showOverall} class="mt-0.5" />
								<Label
									for="show-overall"
									class="cursor-pointer text-sm font-semibold text-slate-700"
								>
									แสดงยอดรวมทุกศูนย์
								</Label>
							</div>
						{/if}
					</Popover.Content>
				</Popover.Root>
			</div>
		</div>

		{#if isLoading}
			<div class="flex-1 space-y-3">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div
				class="flex flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/50 p-12 text-center"
			>
				<Boxes class="mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
				<h3 class="text-base font-semibold text-slate-900">ยังไม่มีรายการพัสดุในระบบ</h3>
				<p class="mt-1 text-sm text-slate-500">
					เพิ่มของใหม่ หรือเปิดแท็บสินค้า (Master) เพื่อเริ่มต้น
				</p>
			</div>
		{:else}
			<!-- Phone cards (< md) -->
			<div class="space-y-3 md:hidden">
				{#if displayedItems.length === 0}
					<div
						class="rounded-xl border border-slate-200/80 bg-white p-8 text-center text-sm font-medium text-slate-500 shadow-2xs"
					>
						ไม่พบรายการที่ตรงเงื่อนไข
					</div>
				{:else}
					{#each paginatedItems as item (item._id)}
						{@const lot = latestLotByItem[item._id]}
						{@const ageLine = ageLineByItem.get(item._id)}
						{@const expired = isExpired(lot?.expiry)}
						{@const expiring = isExpiringSoon(lot?.expiry)}
						{@const display = resolveDisplayStatus(item.status, expired, expiring)}
						<button
							type="button"
							onclick={() => {
								if (!showOverall) openManage(item._id);
							}}
							disabled={showOverall}
							class="w-full rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-2xs transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-80"
						>
							<div class="flex items-start justify-between gap-3">
								<span class="text-base font-semibold text-slate-900">{item.name}</span>
								<span
									class="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {display.badgeClass}"
								>
									{display.label}
								</span>
							</div>
							<p class="mt-2 flex items-baseline gap-1.5">
								<span class="text-xl font-bold text-slate-900 tabular-nums">{item.qtyOnHand}</span>
								<span class="text-sm font-normal text-slate-500">
									{formatUnit(item.unit, units, langState.current)}
								</span>
							</p>
							<p class="mt-1.5 text-sm text-slate-500">
								{getCategoryLabel(item.category)}
								{#if lot?.location}
									<span aria-hidden="true"> · </span>{lot.location}
								{/if}
							</p>
							{#if ageLine}
								<p class="mt-1 text-xs text-slate-500">{ageLine}</p>
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			<!-- Tablet / Desktop table (md+) -->
			<div
				class="hidden flex-1 overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs md:block"
			>
				<Table.Root class="min-w-[720px] text-sm lg:min-w-[880px]">
					<Table.Header class="sticky top-0 z-10 border-b border-slate-200/80 bg-slate-50">
						<Table.Row class="text-xs font-bold tracking-wide text-slate-600 uppercase">
							<Table.Head class="min-h-11 px-4 py-3">ชื่อรายการ</Table.Head>
							<Table.Head class="px-4 py-3">หมวด</Table.Head>
							<Table.Head class="hidden px-4 py-3 lg:table-cell">ที่เก็บ</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ยอดใช้ได้</Table.Head>
							<Table.Head class="px-4 py-3">หน่วย</Table.Head>
							<Table.Head class="px-4 py-3 text-center">สถานะ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body class="divide-y divide-slate-100">
						{#if displayedItems.length === 0}
							<Table.Row>
								<Table.Cell colspan={6} class="p-12 text-center text-sm font-medium text-slate-500">
									ไม่พบรายการที่ตรงเงื่อนไข
								</Table.Cell>
							</Table.Row>
						{:else}
							{#each paginatedItems as item (item._id)}
								{@const lot = latestLotByItem[item._id]}
								{@const ageLine = ageLineByItem.get(item._id)}
								{@const expired = isExpired(lot?.expiry)}
								{@const expiring = isExpiringSoon(lot?.expiry)}
								{@const display = resolveDisplayStatus(item.status, expired, expiring)}
								<Table.Row
									class="min-h-12 cursor-pointer transition-colors hover:bg-slate-50/80 {showOverall
										? 'cursor-default'
										: ''}"
									onclick={() => {
										if (!showOverall) openManage(item._id);
									}}
								>
									<Table.Cell class="px-4 py-3.5">
										<span class="text-sm font-semibold text-slate-900">{item.name}</span>
										{#if ageLine}
											<p class="mt-0.5 text-xs font-normal text-slate-500">{ageLine}</p>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5 text-sm text-slate-700">
										{getCategoryLabel(item.category)}
									</Table.Cell>
									<Table.Cell class="hidden px-4 py-3.5 text-sm text-slate-600 lg:table-cell">
										{#if lot?.location}
											{lot.location}
										{:else}
											<span class="text-slate-400">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5 text-right">
										<span class="text-sm font-bold text-slate-900 tabular-nums">
											{item.qtyOnHand}
										</span>
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5">
										<span class="text-xs font-normal text-slate-500">
											{formatUnit(item.unit, units, langState.current)}
										</span>
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5 text-center">
										<span
											class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {display.badgeClass}"
										>
											{display.label}
										</span>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
			</div>

			{#if totalPages > 1}
				<div class="mt-4 flex justify-end">
					<Pagination.Root
						bind:page={currentPage}
						count={displayedItems.length}
						perPage={PAGE_SIZE}
					>
						{#snippet children({ pages })}
							<Pagination.Content>
								<Pagination.Previous />
								{#each pages as p, i (i)}
									<Pagination.Item>
										{#if p.type === 'page'}
											<Pagination.Link page={p} isActive={p.value === currentPage} />
										{:else}
											<Pagination.Ellipsis />
										{/if}
									</Pagination.Item>
								{/each}
								<Pagination.Next />
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				</div>
			{/if}

			{#if !isLoading && items.length > 0}
				<p class="mt-3 text-sm text-slate-500">
					แสดง {displayedItems.length} จาก {items.length} รายการ
				</p>
			{/if}
		{/if}
	</div>
</div>

{#snippet manageHeader()}
	{#if selectedManageItem}
		<div class="space-y-1">
			<div class="flex items-center gap-2 text-xl font-bold text-slate-900">
				<Boxes class="h-5 w-5 text-teal-700" aria-hidden="true" />
				{selectedManageItem.name}
			</div>
			<p class="text-base font-semibold text-slate-800 tabular-nums">
				ยอดใช้ได้ {selectedManageItem.qtyOnHand}
				<span class="text-sm font-normal text-slate-500">
					{formatUnit(selectedManageItem.unit, units, langState.current)}
				</span>
			</p>
		</div>
	{/if}
{/snippet}

{#snippet manageBody()}
	<div class="grid grid-cols-1 gap-8 lg:grid-cols-12">
		<div class="flex flex-col gap-6 lg:col-span-5 lg:border-r lg:border-slate-200/80 lg:pr-6">
			<div class="flex items-center gap-2 border-b border-slate-200/60 pb-3">
				<span class="text-sm font-bold text-slate-900">จัดการด่วน</span>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<button
					type="button"
					onclick={() => (activeModalTab = 'distribute')}
					class="flex min-h-11 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition-all {activeModalTab ===
					'distribute'
						? 'border-teal-600 bg-teal-600 font-bold text-white shadow-xs'
						: 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'}"
				>
					<MinusCircle
						class="h-5 w-5 {activeModalTab === 'distribute' ? 'text-white' : 'text-orange-500'}"
						aria-hidden="true"
					/>
					<span class="text-xs font-bold whitespace-nowrap">เบิกจ่าย</span>
				</button>
				<button
					type="button"
					onclick={() => (activeModalTab = 'checkin')}
					class="flex min-h-11 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition-all {activeModalTab ===
					'checkin'
						? 'border-teal-600 bg-teal-600 font-bold text-white shadow-xs'
						: 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'}"
				>
					<PlusCircle
						class="h-5 w-5 {activeModalTab === 'checkin' ? 'text-white' : 'text-emerald-500'}"
						aria-hidden="true"
					/>
					<span class="text-xs font-bold whitespace-nowrap">รับเข้า</span>
				</button>
				<button
					type="button"
					onclick={() => (activeModalTab = 'adjust')}
					class="flex min-h-11 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition-all {activeModalTab ===
					'adjust'
						? 'border-teal-600 bg-teal-600 font-bold text-white shadow-xs'
						: 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'}"
				>
					<Settings
						class="h-5 w-5 {activeModalTab === 'adjust' ? 'text-white' : 'text-sky-600'}"
						aria-hidden="true"
					/>
					<span class="text-xs font-bold whitespace-nowrap">ปรับปรุง</span>
				</button>
			</div>

			<div class="mt-2 flex-1">
				{#if selectedItemId}
					{#if activeModalTab === 'checkin'}
						<ReceiveStockForm preselectedItemId={selectedItemId} onsuccess={onMovementSuccess} />
					{:else if activeModalTab === 'distribute'}
						<DistributeStockForm preselectedItemId={selectedItemId} onsuccess={onMovementSuccess} />
					{:else if activeModalTab === 'adjust'}
						<AdjustStockForm preselectedItemId={selectedItemId} onsuccess={onMovementSuccess} />
					{/if}
				{/if}
			</div>
		</div>

		<div class="flex flex-col gap-4 lg:col-span-7">
			<div class="flex items-center gap-2 border-b border-slate-200/60 pb-3">
				<Clock class="h-4 w-4 text-slate-500" aria-hidden="true" />
				<span class="text-sm font-bold text-slate-900">ประวัติการเคลื่อนไหว</span>
			</div>
			<div class="max-h-[60vh] overflow-y-auto">
				{#if selectedItemId}
					<LedgerTable filterItemId={selectedItemId} />
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#if isMobileViewport.current}
	<Sheet.Root bind:open={isManageModalOpen}>
		<Sheet.Content
			side="bottom"
			class="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden rounded-none border-0 p-0 pb-[env(safe-area-inset-bottom)]"
		>
			<Sheet.Header class="shrink-0 border-b border-slate-200/80 px-4 py-4 pr-12 text-left">
				<Sheet.Title class="sr-only">จัดการสต็อก</Sheet.Title>
				<Sheet.Description class="sr-only">รับเข้า เบิกจ่าย หรือปรับปรุงยอดสต็อก</Sheet.Description>
				{@render manageHeader()}
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
				{@render manageBody()}
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Dialog.Root bind:open={isManageModalOpen}>
		<Dialog.Content
			class="max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-md sm:max-w-2xl sm:p-6 lg:max-w-5xl"
		>
			<Dialog.Header class="mb-4 border-b border-slate-200/80 pb-4">
				{#if selectedManageItem}
					<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-slate-900">
						<Boxes class="h-5 w-5 text-teal-700" aria-hidden="true" />
						{selectedManageItem.name}
					</Dialog.Title>
					<Dialog.Description class="mt-1 text-base font-semibold text-slate-800 tabular-nums">
						ยอดใช้ได้ {selectedManageItem.qtyOnHand}
						<span class="text-sm font-normal text-slate-500">
							{formatUnit(selectedManageItem.unit, units, langState.current)}
						</span>
					</Dialog.Description>
				{/if}
			</Dialog.Header>
			{@render manageBody()}
		</Dialog.Content>
	</Dialog.Root>
{/if}

<!-- Quick receive / distribute / adjust (no preselect) -->
{#if isMobileViewport.current}
	<Sheet.Root bind:open={quickActionOpen}>
		<Sheet.Content
			side="bottom"
			class="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden rounded-none border-0 p-0 pb-[env(safe-area-inset-bottom)]"
		>
			<Sheet.Header class="shrink-0 border-b border-slate-200/80 px-4 py-4 pr-12 text-left">
				<Sheet.Title class="text-xl font-bold text-slate-900">
					{quickActionTitle}
				</Sheet.Title>
				<Sheet.Description class="text-sm text-slate-500">
					{quickActionDescription}
				</Sheet.Description>
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
				{#if quickActionKind === 'receive'}
					<ReceiveStockForm onsuccess={onMovementSuccess} />
				{:else if quickActionKind === 'distribute'}
					<DistributeStockForm onsuccess={onMovementSuccess} />
				{:else}
					<AdjustStockForm onsuccess={onMovementSuccess} />
				{/if}
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Dialog.Root bind:open={quickActionOpen}>
		<Dialog.Content
			class="max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-md sm:max-w-lg sm:p-6"
		>
			<Dialog.Header class="mb-4 border-b border-slate-200/80 pb-4">
				<Dialog.Title class="text-xl font-bold text-slate-900">
					{quickActionTitle}
				</Dialog.Title>
				<Dialog.Description class="text-sm text-slate-500">
					{quickActionDescription}
				</Dialog.Description>
			</Dialog.Header>
			{#if quickActionKind === 'receive'}
				<ReceiveStockForm onsuccess={onMovementSuccess} />
			{:else if quickActionKind === 'distribute'}
				<DistributeStockForm onsuccess={onMovementSuccess} />
			{:else}
				<AdjustStockForm onsuccess={onMovementSuccess} />
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{/if}
