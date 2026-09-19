<script lang="ts">
	import type { ItemMaster } from '$lib/features/catalog';
	import { useItemMasters } from '$lib/features/catalog';
	import { useStockBalance } from '$lib/features/operations';
	import type { Flow2RequisitionType } from '../../domain/food-supplies';
	import {
		isEligibleDistributionCatalogItem,
		getReturnableBadgeLabel,
		getReturnableBadgeClass
	} from '../model/catalog-eligibility';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Search from '@lucide/svelte/icons/search';
	import Package from '@lucide/svelte/icons/package';
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';

	interface Props {
		open: boolean;
		requisitionType: Flow2RequisitionType;
		alreadySelectedItemIds: readonly string[];
		onSelectItem: (item: ItemMaster, requestedQty: string) => void;
		onClose: () => void;
	}

	let {
		open = $bindable(false),
		requisitionType,
		alreadySelectedItemIds,
		onSelectItem,
		onClose
	}: Props = $props();

	const itemsQuery = useItemMasters();
	const stockBalanceQuery = useStockBalance();

	let searchQuery = $state('');
	let itemQuantities = $state<Record<string, string>>({});

	// Filter only eligible items for the requisition type
	const eligibleItems = $derived.by(() => {
		const allItems = itemsQuery.data ?? [];
		return allItems.filter((item) => isEligibleDistributionCatalogItem(item, requisitionType));
	});

	// Further filter by search term (name or SKU)
	const filteredItems = $derived.by(() => {
		const term = searchQuery.trim().toLowerCase();
		if (!term) return eligibleItems;
		return eligibleItems.filter((item) => {
			const matchName = item.name.toLowerCase().includes(term);
			const matchSku = item.sku ? item.sku.toLowerCase().includes(term) : false;
			return matchName || matchSku;
		});
	});

	function getStockOnHand(itemId: string): string {
		return stockBalanceQuery.data?.get(itemId) ?? '0';
	}

	function handleAdd(item: ItemMaster) {
		const rawQty = itemQuantities[item._id] ?? '1';
		const num = parseFloat(rawQty);
		if (isNaN(num) || num <= 0) return;
		onSelectItem(item, String(num));
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) onClose();
	}}
>
	<Dialog.Content class="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-[700px]">
		<!-- Header -->
		<div class="border-b border-slate-200/80 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="text-lg font-bold text-slate-900">
					เลือกรายการพัสดุ / อาหารสำหรับตั๋วเบิกจ่าย
				</Dialog.Title>
				<Dialog.Description class="text-xs text-slate-500">
					{requisitionType === 'food'
						? 'แสดงเฉพาะรายการอาหารปรุงสุกพร้อมรับประทาน (Ready-Meal) เท่านั้น ไม่อนุญาตให้เบิกวัตถุดิบครัว'
						: 'แสดงเฉพาะพัสดุ สิ่งของบรรเทาทุกข์ และอุปกรณ์ (ตัดหมวดหมู่อาหารทุกประเภทออก)'}
				</Dialog.Description>
			</Dialog.Header>

			<!-- Search Bar -->
			<div class="relative mt-4">
				<Search class="absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="ค้นหาชื่อรายการ หรือ SKU..."
					aria-label="ค้นหาชื่อรายการ หรือ SKU"
					class="h-10 w-full rounded-lg border border-slate-200/80 bg-white pr-3 pl-9 text-sm text-slate-800 shadow-2xs placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
				/>
			</div>
		</div>

		<!-- Item List -->
		<div class="flex-1 divide-y divide-slate-100 overflow-y-auto p-6">
			{#if itemsQuery.isLoading}
				<div
					class="flex flex-col items-center justify-center p-8 text-center text-sm text-slate-500"
				>
					กำลังโหลดรายการจาก Master Catalog...
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
					<div
						class="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between {isAlreadyAdded
							? 'bg-slate-50/50 opacity-60'
							: ''}"
					>
						<!-- Item info -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-bold text-slate-900">{item.name}</span>
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
								<div class="flex items-center gap-1.5">
									<label for="qty-{item._id}" class="sr-only">จำนวนที่ต้องการเบิก</label>
									<input
										id="qty-{item._id}"
										type="number"
										min="1"
										step="any"
										value={itemQuantities[item._id] ?? '1'}
										oninput={(e) => {
											itemQuantities[item._id] = e.currentTarget.value;
										}}
										class="h-9 w-20 rounded-lg border border-slate-200/80 bg-white px-2.5 text-right text-sm font-semibold text-slate-800 tabular-nums shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
									/>
									<span class="min-w-[30px] text-xs text-slate-500">{item.base_unit}</span>
								</div>

								<button
									type="button"
									onclick={() => handleAdd(item)}
									class="inline-flex h-9 items-center gap-1 rounded-lg bg-[#0A2647] px-3 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930]"
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

		<!-- Footer -->
		<div class="flex justify-end border-t border-slate-200 bg-slate-50/75 px-6 py-3">
			<button
				type="button"
				onclick={onClose}
				class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
			>
				ปิดหน้าต่าง
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>
