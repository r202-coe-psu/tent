<script lang="ts">
	import type { ItemAllocationPlan } from './approval-allocation-form';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Package from '@lucide/svelte/icons/package';
	import Calendar from '@lucide/svelte/icons/calendar';

	interface Props {
		plan: ItemAllocationPlan;
		lotInputMap: Record<string, string>;
		disabled?: boolean;
		onLotQtyChange: (inputKey: string, qty: string) => void;
	}

	let { plan, lotInputMap, disabled = false, onLotQtyChange }: Props = $props();

	function handleInput(inputKey: string, e: Event) {
		const target = e.target as HTMLInputElement;
		onLotQtyChange(inputKey, target.value);
	}
</script>

<div class="space-y-2.5">
	{#if plan.lotEntries.length === 0}
		<div
			class="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
		>
			<TriangleAlert class="size-4 shrink-0 text-amber-600" />
			<span>ไม่มี Physical Lot ที่มีสินค้าคงเหลือในคลังสำหรับรายการนี้</span>
		</div>
	{:else}
		<div class="space-y-2">
			{#each plan.lotEntries as lot (lot.input_key || lot.lot_ref)}
				{@const inputKey = lot.input_key || lot.lot_ref}
				{@const currentInput = lotInputMap[inputKey] ?? lotInputMap[lot.lot_ref] ?? ''}
				<div
					class="flex flex-col justify-between gap-3 rounded-xl border p-2.5 sm:flex-row sm:items-center {lot.isOverLot
						? 'border-red-300 bg-red-50/50'
						: 'border-slate-200 bg-slate-50/50'} transition-colors hover:bg-slate-100/50"
				>
					<div class="min-w-0 space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-xs font-bold text-slate-800">
								{lot.lot_no ? `Lot ${lot.lot_no}` : 'Lot (ไม่มีเลขระบุ)'}
							</span>
							<span
								class="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
								title={lot.lot_ref}
							>
								{lot.lot_ref.length > 24 ? `…${lot.lot_ref.slice(-12)}` : lot.lot_ref}
							</span>
							{#if lot.storage_zone}
								<Badge variant="outline" class="px-1.5 py-0 text-[10px]">
									โซน: {lot.storage_zone}
								</Badge>
							{/if}
						</div>

						<div class="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
							{#if lot.expiry}
								<span class="flex items-center gap-1">
									<Calendar class="size-3 text-slate-400" />
									หมดอายุ: <strong class="text-slate-700">{lot.expiry}</strong>
								</span>
							{/if}
							<span class="flex items-center gap-1">
								<Package class="size-3 text-slate-400" />
								คงเหลือในคลัง:
								<strong class="text-slate-700">{lot.available_qty} {plan.unit}</strong>
							</span>
						</div>

						{#if lot.isOverLot}
							<p class="text-[10px] font-bold text-red-600">
								⚠ จำนวนจัดสรรเกินจำนวนคงเหลือใน Lot นี้ ({lot.available_qty}
								{plan.unit})
							</p>
						{/if}
					</div>

					<div class="flex shrink-0 items-center gap-2">
						<div class="hidden text-right sm:block">
							<span class="block text-[10px] text-slate-400">จำนวนจัดสรร</span>
						</div>
						<div class="w-24">
							<Input
								type="number"
								min="0"
								step="any"
								placeholder="0"
								value={currentInput}
								{disabled}
								oninput={(e) => handleInput(inputKey, e)}
								class="h-8 text-center text-xs font-bold {lot.isOverLot
									? 'border-red-500 focus-visible:ring-red-500'
									: ''}"
							/>
						</div>
						<span class="min-w-[28px] text-xs font-medium text-slate-500">{plan.unit}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
