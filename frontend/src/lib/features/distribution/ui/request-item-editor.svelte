<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { ItemMaster } from '$lib/features/catalog';
	import { itemMasterUnit } from '$lib/features/catalog';
	import { createInitialFormItem, type CreateRequestFormItem } from './create-request-form';

	interface Props {
		items: CreateRequestFormItem[];
		itemMasters: readonly ItemMaster[];
		targetQty?: string;
		disabled?: boolean;
		errors?: Record<string, string>;
		stockBalances?: Map<string, string>;
		onItemsChange?: (items: CreateRequestFormItem[]) => void;
	}

	let {
		items = $bindable([]),
		itemMasters = [],
		targetQty = '0',
		disabled = false,
		errors = {},
		stockBalances = new Map<string, string>(),
		onItemsChange
	}: Props = $props();

	const activeItemMasters = $derived(itemMasters.filter((master) => !master.deactivated));

	const itemMasterMap = $derived(
		new Map<string, ItemMaster>(activeItemMasters.map((m) => [m._id, m]))
	);

	function handleAddItem() {
		if (disabled) return;
		const nextItems = [...items, createInitialFormItem()];
		items = nextItems;
		onItemsChange?.(nextItems);
	}

	function handleRemoveItem(index: number) {
		if (disabled || items.length <= 1) return;
		const nextItems = items.filter((_, i) => i !== index);
		items = nextItems;
		onItemsChange?.(nextItems);
	}

	function handleItemChange(index: number, itemId: string) {
		if (disabled) return;
		const nextItems = [...items];
		nextItems[index] = {
			...nextItems[index],
			itemId
		};
		items = nextItems;
		onItemsChange?.(nextItems);
	}

	function handleQtyChange(index: number, qtyStr: string) {
		if (disabled) return;
		const nextItems = [...items];
		nextItems[index] = {
			...nextItems[index],
			requestedQty: qtyStr
		};
		items = nextItems;
		onItemsChange?.(nextItems);
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<span class="text-sm font-semibold text-foreground">
			รายการสิ่งของที่ต้องการเบิกจ่าย <span class="text-destructive">*</span>
		</span>
		<Button
			type="button"
			variant="outline"
			size="sm"
			{disabled}
			onclick={handleAddItem}
			class="h-8 gap-1.5 text-xs font-medium"
		>
			<Plus class="h-3.5 w-3.5" />
			เพิ่มรายการ
		</Button>
	</div>

	{#if errors.items}
		<p class="text-xs font-medium text-destructive">{errors.items}</p>
	{/if}

	<div class="space-y-2.5">
		{#each items as item, index (item.id)}
			{@const currentMaster = item.itemId ? itemMasterMap.get(item.itemId) : undefined}
			{@const unit = currentMaster ? itemMasterUnit(currentMaster) : '-'}
			{@const itemError = errors[`item_${index}_id`]}
			{@const qtyError = errors[`item_${index}_qty`]}

			<div
				class="flex flex-col gap-2 rounded-lg border border-border/70 bg-card p-3 shadow-2xs sm:flex-row sm:items-center sm:gap-3"
			>
				<!-- Item Selector -->
				<div class="flex-1 space-y-1">
					<div class="relative">
						<select
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 {itemError
								? 'border-destructive'
								: ''}"
							value={item.itemId}
							{disabled}
							onchange={(e) => handleItemChange(index, (e.target as HTMLSelectElement).value)}
						>
							<option value="" disabled>-- เลือกสิ่งของจาก Catalog --</option>
							{#each activeItemMasters as master (master._id)}
								{@const stock = stockBalances.get(master._id) ?? '0'}
								{@const masterUnit = itemMasterUnit(master)}
								<option value={master._id}>
									{master.name} ({masterUnit}) — คงเหลือ: {stock}
									{masterUnit}
								</option>
							{/each}
						</select>
					</div>
					{#if itemError}
						<p class="text-xs font-medium text-destructive">{itemError}</p>
					{:else if currentMaster}
						{@const currentStock = stockBalances.get(currentMaster._id) ?? '0'}
						<div class="flex items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
							<span
								class="inline-block size-1.5 rounded-full {Number(currentStock) > 0
									? 'bg-emerald-500'
									: 'bg-amber-400'}"
							></span>
							<span>
								คงเหลือในคลัง: <strong class="font-medium text-foreground">{currentStock}</strong>
								{unit}
							</span>
						</div>
					{/if}
				</div>

				<!-- Quantity Input & Unit -->
				<div class="flex items-center gap-2 sm:w-56">
					<div class="flex-1 space-y-1">
						<div class="relative flex items-center">
							<Input
								type="text"
								inputmode="decimal"
								placeholder="จำนวน"
								class="h-9 pr-12 {qtyError ? 'border-destructive' : ''}"
								value={item.requestedQty}
								{disabled}
								oninput={(e) => handleQtyChange(index, (e.target as HTMLInputElement).value)}
							/>
							<span
								class="pointer-events-none absolute right-3 text-xs font-medium text-muted-foreground"
							>
								{unit}
							</span>
						</div>
						{#if qtyError}
							<p class="text-xs font-medium text-destructive">{qtyError}</p>
						{:else if targetQty && targetQty !== '-' && targetQty !== '0' && currentMaster}
							<p class="text-[10px] text-muted-foreground">เป้าหมาย NFI: {targetQty} {unit}</p>
						{/if}
					</div>

					<!-- Delete Row Button -->
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="h-9 w-9 text-muted-foreground hover:text-destructive"
						disabled={disabled || items.length <= 1}
						onclick={() => handleRemoveItem(index)}
						title="ลบรายการนี้"
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
			</div>
		{/each}
	</div>
</div>
