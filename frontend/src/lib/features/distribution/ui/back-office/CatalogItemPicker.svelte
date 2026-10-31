<script lang="ts">
	import type { ItemMaster } from '$lib/features/catalog';
	import { useItemMasters } from '$lib/features/catalog';
	import { isOutOfStock, sortInStockFirstByName, useStockBalance } from '$lib/features/operations';
	import type { Flow2RequisitionType } from '../../domain/food-supplies';
	import {
		isEligibleDistributionCatalogItem,
		getReturnableBadgeLabel,
		getReturnableBadgeClass
	} from '../model/catalog-eligibility';
	import { validatePositiveQuantity } from '../model/ticket-quantity';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import Package from '@lucide/svelte/icons/package';
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';

	interface Props {
		shelterCode: string;
		requisitionType: Flow2RequisitionType;
		alreadySelectedItemIds: readonly string[];
		onSelectItem: (item: ItemMaster, requestedQty: string) => void;
	}

	let { shelterCode, requisitionType, alreadySelectedItemIds, onSelectItem }: Props = $props();

	const itemsQuery = useItemMasters(() => shelterCode);
	const stockBalanceQuery = useStockBalance();

	let searchQuery = $state('');
	let itemQuantities = $state<Record<string, string>>({});

	// Filter only eligible items for the requisition type
	const eligibleItems = $derived.by(() => {
		const allItems = itemsQuery.data ?? [];
		return allItems.filter((item) => isEligibleDistributionCatalogItem(item, requisitionType));
	});

	// Further filter by search term (name or SKU)
	const textFilteredItems = $derived.by(() => {
		const term = searchQuery.trim().toLowerCase();
		if (!term) return eligibleItems;
		return eligibleItems.filter((item) => {
			const matchName = item.name.toLowerCase().includes(term);
			const matchSku = item.sku ? item.sku.toLowerCase().includes(term) : false;
			return matchName || matchSku;
		});
	});

	// In-stock items first, then out-of-stock; each group by name. Out-of-stock stays addable.
	// Skip sorting and out-of-stock styling until balances have loaded.
	const balancesLoaded = $derived(stockBalanceQuery.data !== undefined);
	const filteredItems = $derived(
		balancesLoaded
			? sortInStockFirstByName(
					textFilteredItems,
					(item) => stockBalanceQuery.data?.get(item._id),
					(item) => item.name
				)
			: textFilteredItems
	);

	function getStockOnHand(itemId: string): string {
		return stockBalanceQuery.data?.get(itemId) ?? '0';
	}

	function handlePickerQtyBlur(raw: string) {
		validatePositiveQuantity(raw);
	}

	function handleAdd(item: ItemMaster) {
		if (balancesLoaded && isOutOfStock(getStockOnHand(item._id))) return;
		const rawQty = itemQuantities[item._id] ?? '1';
		const validation = validatePositiveQuantity(rawQty);
		if (!validation.isValid || !validation.value) {
			toast.error(validation.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง');
			return;
		}
		onSelectItem(item, validation.value);
	}
</script>

<section
	class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs"
	aria-label="เลือกรายการพัสดุ / อาหารสำหรับตั๋วเบิกจ่าย"
>
	<!-- Header -->
	<div class="border-b border-slate-200/80 px-4 pt-4 pb-3 sm:px-5">
		<h3 class="text-sm font-bold text-slate-900">เลือกรายการพัสดุ / อาหารสำหรับตั๋วเบิกจ่าย</h3>
		<p class="text-xs text-slate-500">
			{requisitionType === 'food'
				? 'แสดงเฉพาะรายการอาหารปรุงสุกพร้อมรับประทานเท่านั้น ไม่อนุญาตให้เบิกวัตถุดิบครัว'
				: 'แสดงเฉพาะพัสดุ สิ่งของบรรเทาทุกข์ และอุปกรณ์ (ตัดหมวดหมู่อาหารทุกประเภทออก)'}
		</p>

		<!-- Search Bar -->
		<div class="relative mt-3">
			<Search class="absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
			<Input
				type="text"
				bind:value={searchQuery}
				placeholder="ค้นหาชื่อรายการ หรือ SKU..."
				aria-label="ค้นหาชื่อรายการ หรือ SKU"
				class="h-10 w-full rounded-lg pl-9 text-sm shadow-2xs placeholder:text-slate-400"
			/>
		</div>
	</div>

	<!-- Item List -->
	<div class="max-h-[420px] flex-1 divide-y divide-slate-100 overflow-y-auto px-4 py-2 sm:px-5">
		{#if itemsQuery.isLoading}
			<div class="flex flex-col items-center justify-center p-8 text-center text-sm text-slate-500">
				กำลังโหลดรายการสินค้า...
			</div>
		{:else if filteredItems.length === 0}
			<div class="flex flex-col items-center justify-center p-8 text-center">
				<div
					class="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"
				>
					<Package class="h-5 w-5" />
				</div>
				<p class="text-sm font-semibold text-slate-800">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
				<p class="mt-0.5 text-xs text-slate-500">
					{requisitionType === 'food'
						? 'ไม่มีรายการอาหารปรุงสุกพร้อมรับประทานที่ลงทะเบียนในแคตตาล็อก'
						: 'ไม่มีรายการพัสดุที่ตรงกับคำค้นหา'}
				</p>
			</div>
		{:else}
			{#each filteredItems as item (item._id)}
				{@const isAlreadyAdded = alreadySelectedItemIds.includes(item._id)}
				{@const stockOnHand = getStockOnHand(item._id)}
				{@const outOfStock = balancesLoaded && isOutOfStock(stockOnHand)}
				<div
					class="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between {isAlreadyAdded
						? 'bg-slate-50/50 opacity-60'
						: ''}"
				>
					<!-- Item info -->
					<div class="min-w-0 flex-1 {outOfStock ? 'opacity-60' : ''}">
						<div class="flex items-center gap-2">
							<span class="truncate text-sm font-bold text-slate-900">{item.name}</span>
							{#if outOfStock}
								<span
									class="shrink-0 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive"
								>
									หมด
								</span>
							{/if}
							<!-- Read-only Returnable Badge derived from catalog -->
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {getReturnableBadgeClass(
									item.returnable
								)}"
							>
								{getReturnableBadgeLabel(item.returnable)}
							</span>
						</div>

						<div class="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
							{#if item.sku}
								<span class="font-mono">SKU: {item.sku}</span>
								<span>•</span>
							{/if}
							<span>หน่วย: {item.base_unit}</span>
							<span>•</span>
							<span class="tabular-nums">
								คงเหลือในคลัง: <strong class="font-semibold text-slate-800">{stockOnHand}</strong>
								{item.base_unit}
							</span>
						</div>
					</div>

					<!-- Action: Quantity Input + Add button -->
					<div class="flex shrink-0 items-center gap-2">
						{#if isAlreadyAdded}
							<span
								class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
							>
								<Check class="h-3.5 w-3.5" />
								เพิ่มในตั๋วแล้ว
							</span>
						{:else}
							<div class="flex flex-col items-end gap-1">
								<div class="flex items-center gap-1.5">
									<label for="qty-{item._id}" class="sr-only">จำนวนที่ต้องการเบิก</label>
									<Input
										id="qty-{item._id}"
										type="text"
										inputmode="numeric"
										step="1"
										min="1"
										value={itemQuantities[item._id] ?? '1'}
										oninput={(e) => {
											itemQuantities[item._id] = e.currentTarget.value;
										}}
										onblur={(e) => {
											handlePickerQtyBlur(e.currentTarget.value);
										}}
										disabled={outOfStock}
										class="h-9 w-20 text-right text-sm font-semibold tabular-nums shadow-2xs"
									/>
									<span class="min-w-[30px] text-xs text-slate-500">{item.base_unit}</span>
								</div>
							</div>

							<button
								type="button"
								onclick={() => handleAdd(item)}
								disabled={outOfStock}
								class="inline-flex h-9 items-center gap-1 rounded-lg bg-[#0A2647] px-3 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#0A2647]"
							>
								<Plus class="h-3.5 w-3.5" />
								<span>เลือก</span>
							</button>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</section>
