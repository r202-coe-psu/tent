<script lang="ts">
	import { useLedger } from '$lib/features/operations';
	import { getEligiblePhysicalLots } from '../model/physical-lot';
	import Check from '@lucide/svelte/icons/check';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Calendar from '@lucide/svelte/icons/calendar';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	interface Props {
		itemId: string;
		itemName: string;
		unit?: string;
		allocatedQty: string;
		selectedLotRef?: string;
		onSelect: (lotRef: string) => void;
		disabled?: boolean;
	}

	let {
		itemId,
		itemName,
		unit = 'ชิ้น',
		allocatedQty,
		selectedLotRef = '',
		onSelect,
		disabled = false
	}: Props = $props();

	// Remote-First query to fetch authoritative shelter stock ledger
	const ledgerQuery = useLedger();

	const lots = $derived.by(() => {
		if (!ledgerQuery.data) return [];
		return getEligiblePhysicalLots(ledgerQuery.data, itemId, allocatedQty);
	});

	const isLoading = $derived(ledgerQuery.isLoading);
	const hasNoLots = $derived(!isLoading && lots.length === 0);

	function formatExpiryDate(dateStr?: string): string {
		if (!dateStr) return 'ไม่ระบุวันหมดอายุ';
		try {
			return new Intl.DateTimeFormat('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			}).format(new Date(dateStr));
		} catch {
			return dateStr;
		}
	}
</script>

<div class="space-y-2.5">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Boxes class="h-4 w-4 text-[#0A2647]" />
			<span class="text-xs font-bold text-slate-800">
				เลือก Physical Lot สำหรับ: <strong class="text-[#0A2647]">{itemName}</strong>
			</span>
		</div>
		<span class="text-2xs font-semibold text-slate-500 tabular-nums">
			ยอดที่ต้องจ่าย: <strong class="text-slate-900">{allocatedQty}</strong>
			{unit}
		</span>
	</div>

	{#if isLoading}
		<div
			class="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-500"
		>
			<Loader2 class="h-4 w-4 animate-spin text-[#0A2647]" />
			<span>กำลังตรวจสอบรายการ Lot ในคลังสินค้า...</span>
		</div>
	{:else if hasNoLots}
		<div
			class="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900"
		>
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
			<div>
				<strong>ไม่พบ Lot สินค้าคงคลังพร้อมใช้ในคลังสินค้า</strong>
				<p class="mt-0.5 text-2xs text-amber-800">
					ไม่พบประวัติรับสินค้าที่มีคงเหลือมากกว่า 0 ชิ้นสำหรับรายการนี้
					กรุณาตรวจสอบการรับสินค้าเข้าสต็อกก่อนดำเนินการปล่อยของ
				</p>
			</div>
		</div>
	{:else}
		<!-- Available Lots List (Sorted by FEFO) -->
		<div
			class="space-y-2"
			role="radiogroup"
			aria-label="เลือก Physical Lot สินค้าสำหรับ {itemName}"
		>
			{#each lots as lot, idx (lot.lot_ref)}
				{@const isSelected = selectedLotRef === lot.lot_ref}
				{@const canBeSelected = !disabled && !lot.isExpired && lot.hasSufficientQty}

				<div
					class="relative flex cursor-pointer items-start justify-between rounded-xl border p-3 transition-all {isSelected
						? 'border-emerald-600 bg-emerald-50/40 shadow-xs ring-2 ring-emerald-500/20'
						: canBeSelected
							? 'border-slate-200 bg-white shadow-2xs hover:border-slate-300 hover:bg-slate-50/60'
							: 'cursor-not-allowed border-slate-200 bg-slate-50/70 opacity-65'}"
					onclick={() => {
						if (canBeSelected) {
							onSelect(lot.lot_ref);
						}
					}}
					onkeydown={(e) => {
						if ((e.key === 'Enter' || e.key === ' ') && canBeSelected) {
							e.preventDefault();
							onSelect(lot.lot_ref);
						}
					}}
					role="radio"
					aria-checked={isSelected}
					aria-disabled={!canBeSelected}
					tabindex={canBeSelected ? 0 : -1}
				>
					<div class="min-w-0 flex-1 space-y-1">
						<!-- Lot Identifier & FEFO Tag -->
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-mono text-xs font-bold text-slate-900">
								{lot.lot_no ?? lot.lot_ref.replace('stock_ledger:', 'LOT-')}
							</span>

							{#if idx === 0 && lot.expiry}
								<span
									class="py-0.2 rounded-md border border-emerald-200 bg-emerald-100/70 px-1.5 text-3xs font-bold text-emerald-800"
								>
									FEFO ลำดับแรก
								</span>
							{/if}

							{#if lot.isExpired}
								<span
									class="py-0.2 rounded-md border border-red-200 bg-red-100 px-1.5 text-3xs font-bold text-red-700"
								>
									หมดอายุแล้ว
								</span>
							{:else if !lot.hasSufficientQty}
								<span
									class="py-0.2 rounded-md border border-amber-200 bg-amber-100 px-1.5 text-3xs font-bold text-amber-800"
								>
									ยอดไม่พอ ({lot.qty} / ต้องการ {allocatedQty})
								</span>
							{/if}
						</div>

						<!-- Provenance Metadata -->
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-slate-500">
							<div class="flex items-center gap-1">
								<Calendar class="h-3 w-3 text-slate-400" />
								<span
									>วันหมดอายุ: <strong
										class={lot.isExpired ? 'font-bold text-red-700' : 'text-slate-700'}
										>{formatExpiryDate(lot.expiry)}</strong
									></span
								>
							</div>

							{#if lot.storage_zone}
								<div class="flex items-center gap-1">
									<MapPin class="h-3 w-3 text-slate-400" />
									<span>โซน: <strong class="text-slate-700">{lot.storage_zone}</strong></span>
								</div>
							{/if}

							{#if lot.note}
								<span class="text-slate-400">({lot.note})</span>
							{/if}
						</div>
					</div>

					<!-- Available Qty & Selection Indicator -->
					<div class="ml-3 flex shrink-0 flex-col items-end justify-center">
						<div class="text-right">
							<span class="text-2xs text-slate-400">คงเหลือใน Lot</span>
							<div class="text-sm font-bold text-slate-900 tabular-nums">
								{lot.qty} <span class="text-2xs font-normal text-slate-500">{unit}</span>
							</div>
						</div>

						<!-- Selection Circle Indicator -->
						<div
							class="mt-1.5 flex h-5 w-5 items-center justify-center rounded-full border transition-all {isSelected
								? 'border-emerald-600 bg-emerald-600 text-white'
								: 'border-slate-300 bg-white'}"
						>
							{#if isSelected}
								<Check class="h-3.5 w-3.5 stroke-[3]" />
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
