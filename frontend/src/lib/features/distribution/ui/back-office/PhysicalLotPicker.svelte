<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { toLotPriorityItems, useLedger } from '$lib/features/operations';
	import { useItemMasters } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { parseQty, qtyGt } from '$lib/utils/qty';
	import {
		sumDispatchAllocations,
		validateDispatchLotAllocations,
		type DispatchLotAllocation
	} from '../../domain/food-supplies';
	import {
		getEligiblePhysicalLots,
		lotInputMax,
		planAutoLotAllocation
	} from '../model/physical-lot';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Calendar from '@lucide/svelte/icons/calendar';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
	import { formatThaiShortDate } from '$lib/utils/date';

	interface Props {
		itemId: string;
		itemName: string;
		unit?: string;
		allocatedQty: string;
		/** Initial allocations (item split across lots). */
		allocations?: DispatchLotAllocation[];
		/** Emits the cleaned allocations (empty / zero rows removed) and whether they are valid. */
		onChange: (allocations: DispatchLotAllocation[], valid: boolean) => void;
		disabled?: boolean;
	}

	let {
		itemId,
		itemName,
		unit = 'ชิ้น',
		allocatedQty,
		allocations = [],
		onChange,
		disabled = false
	}: Props = $props();

	// Remote-First query to fetch authoritative shelter stock ledger
	const ledgerQuery = useLedger();

	// Shelf life / storage type feed the weighted lot order (CR-143 §A)
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const priorityItem = $derived((itemMastersQuery.data ?? []).find((im) => im._id === itemId));

	const lots = $derived.by(() => {
		if (!ledgerQuery.data || itemMastersQuery.isLoading) return [];
		return getEligiblePhysicalLots(
			ledgerQuery.data,
			itemId,
			allocatedQty,
			new Date(),
			priorityItem
		);
	});
	// The first lot a person may actually draw from: expired lots are never suggested (FR-A4)
	const firstUsableLotRef = $derived(lots.find((l) => !l.isExpired)?.lot_ref);

	// Raw qty text per lot; empty or 0 means the lot is not used
	let draft = $state<Record<string, string>>(
		untrack(() => Object.fromEntries(allocations.map((a) => [a.lot_ref, a.qty])))
	);

	function isUsableQty(value: string | undefined): value is string {
		if (!value || value.trim() === '') return false;
		try {
			return qtyGt(value, 0);
		} catch {
			return false;
		}
	}

	function cleaned(source: Record<string, string>): DispatchLotAllocation[] {
		return lots
			.filter((lot) => isUsableQty(source[lot.lot_ref]))
			.map((lot) => ({ lot_ref: lot.lot_ref, qty: source[lot.lot_ref].trim() }));
	}

	const current = $derived(cleaned(draft));
	const total = $derived(sumDispatchAllocations(current));
	const candidates = $derived(
		lots.map((lot) => ({ lot_ref: lot.lot_ref, qty: lot.qty, expired: lot.isExpired }))
	);
	const validation = $derived(validateDispatchLotAllocations(allocatedQty, current, candidates));
	const totalState = $derived.by(() => {
		if (parseQty(total).eq(parseQty(allocatedQty))) return 'ok';
		return parseQty(total).lt(parseQty(allocatedQty)) ? 'short' : 'over';
	});

	function overBalance(lotRef: string, remaining: string): boolean {
		const value = draft[lotRef];
		return isUsableQty(value) && qtyGt(value, remaining);
	}

	function emit(next: Record<string, string>) {
		const list = cleaned(next);
		onChange(list, validateDispatchLotAllocations(allocatedQty, list, candidates).ok);
	}

	/** Cap for one lot's input: its balance, and what the other lots leave of the allocation. */
	function maxFor(lotRef: string, lotQty: string): string {
		const others = sumDispatchAllocations(current.filter((a) => a.lot_ref !== lotRef));
		return lotInputMax(lotQty, allocatedQty, others);
	}

	function setQty(lotRef: string, lotQty: string, value: string) {
		let next = value;
		if (isUsableQty(value)) {
			const max = maxFor(lotRef, lotQty);
			if (qtyGt(value, max)) next = max;
		}
		draft = { ...draft, [lotRef]: next };
		emit(draft);
	}

	function autoAllocate() {
		const nowMs = Date.now();
		const priorityMap = toLotPriorityItems(itemMastersQuery.data ?? []);
		const plan = planAutoLotAllocation(ledgerQuery.data, itemId, allocatedQty, priorityMap, nowMs);
		if (!plan.complete) {
			toast.error(
				`สต็อกที่ใช้ได้ไม่พอ: มี ${plan.available} ${unit} แต่ต้องจ่าย ${allocatedQty} ${unit}`
			);
			return;
		}
		draft = Object.fromEntries(plan.allocations.map((a) => [a.lot_ref, a.qty]));
		onChange(
			plan.allocations.map((a) => ({ lot_ref: a.lot_ref, qty: a.qty })),
			true
		);
	}

	// Wait for item masters too, so the lot order does not reshuffle once shelf life arrives
	const isLoading = $derived(ledgerQuery.isLoading || itemMastersQuery.isLoading);
	const hasNoLots = $derived(!isLoading && lots.length === 0);

	function formatExpiryDate(dateStr?: string): string {
		if (!dateStr) return 'ไม่ระบุวันหมดอายุ';
		return formatThaiShortDate(dateStr) || dateStr;
	}
</script>

<div class="space-y-2.5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<Boxes class="h-4 w-4 text-[#0A2647]" />
			<span class="text-xs font-bold text-slate-800">
				เลือก Physical Lot สำหรับ: <strong class="text-[#0A2647]">{itemName}</strong>
			</span>
		</div>
		<div class="flex items-center gap-2">
			<span
				class="text-xs font-semibold tabular-nums {totalState === 'ok'
					? 'text-emerald-700'
					: totalState === 'short'
						? 'text-amber-700'
						: 'text-red-700'}"
				aria-live="polite"
			>
				เลือกแล้ว <strong>{total}</strong> / ต้องจ่าย <strong>{allocatedQty}</strong>
				{unit}
				{#if totalState === 'short'}
					(ยังขาด)
				{:else if totalState === 'over'}
					(เกินยอด)
				{/if}
			</span>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="h-9 text-xs font-semibold"
				disabled={disabled || isLoading || hasNoLots}
				onclick={autoAllocate}
			>
				<WandSparkles class="h-3.5 w-3.5" />
				จัดสรรอัตโนมัติ
			</Button>
		</div>
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
				<p class="mt-0.5 text-xs text-amber-800">
					ไม่พบประวัติรับสินค้าที่มีคงเหลือมากกว่า 0 ชิ้นสำหรับรายการนี้
					กรุณาตรวจสอบการรับสินค้าเข้าสต็อกก่อนดำเนินการปล่อยของ
				</p>
			</div>
		</div>
	{:else}
		<!-- Available Lots List (weighted issue priority, CR-143 §A) -->
		<ul class="space-y-2" aria-label="กำหนดจำนวนจาก Physical Lot สินค้าสำหรับ {itemName}">
			{#each lots as lot (lot.lot_ref)}
				{@const isUsed = isUsableQty(draft[lot.lot_ref])}
				{@const canEdit = !disabled && !lot.isExpired}
				{@const isOver = !lot.isExpired && overBalance(lot.lot_ref, lot.qty)}
				{@const maxQty = maxFor(lot.lot_ref, lot.qty)}
				{@const capped = canEdit && !isUsed && !qtyGt(maxQty, 0)}
				{@const inputId = `lot-qty-${itemId}-${lot.lot_ref}`}

				<li
					class="relative flex items-start justify-between rounded-xl border p-3 transition-all {isOver
						? 'border-red-400 bg-red-50/40'
						: isUsed && !lot.isExpired
							? 'border-emerald-600 bg-emerald-50/40 shadow-xs ring-2 ring-emerald-500/20'
							: lot.isExpired
								? 'border-slate-200 bg-slate-50/70 opacity-65'
								: 'border-slate-200 bg-white shadow-2xs'}"
				>
					<div class="min-w-0 flex-1 space-y-1">
						<!-- Lot Identifier & priority tag -->
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="text-xs font-bold break-all text-slate-900 tabular-nums"
								title={lot.lot_no ?? lot.lot_ref}
							>
								{lot.lot_no ?? lot.lot_ref.replace('stock_ledger:', 'LOT-')}
							</span>

							{#if lot.lot_ref === firstUsableLotRef}
								<span
									class="py-0.2 rounded-md border border-emerald-200 bg-emerald-100/70 px-1.5 text-3xs font-bold text-emerald-800"
								>
									ควรใช้ก่อน
								</span>
							{/if}

							{#if lot.isExpired}
								<span
									class="py-0.2 rounded-md border border-red-200 bg-red-100 px-1.5 text-3xs font-bold text-red-700"
								>
									หมดอายุแล้ว
								</span>
							{/if}
						</div>

						<!-- Provenance Metadata -->
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
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
						<p class="text-xs font-medium {lot.isExpired ? 'text-red-700' : 'text-slate-600'}">
							{lot.reason}
						</p>
					</div>

					<!-- Remaining Qty & per-lot quantity input -->
					<div class="ml-3 flex shrink-0 flex-col items-end justify-center gap-1">
						<div class="text-right">
							<span class="text-xs text-slate-400">คงเหลือใน Lot</span>
							<div class="text-sm font-bold text-slate-900 tabular-nums">
								{lot.qty} <span class="text-xs font-normal text-slate-500">{unit}</span>
							</div>
						</div>
						<label for={inputId} class="text-xs font-semibold text-slate-600">
							จำนวนที่ใช้จาก Lot นี้
						</label>
						<Input
							id={inputId}
							type="number"
							min="0"
							max={maxQty}
							step="any"
							inputmode="decimal"
							value={draft[lot.lot_ref] ?? ''}
							oninput={(e: Event) =>
								setQty(lot.lot_ref, lot.qty, (e.currentTarget as HTMLInputElement).value)}
							disabled={!canEdit}
							readonly={capped}
							aria-disabled={capped || !canEdit}
							aria-invalid={isOver}
							title={capped ? 'ครบจำนวนที่ต้องจ่ายแล้ว' : undefined}
							class="h-11 w-28 [appearance:textfield] text-right text-xs tabular-nums sm:h-9 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none {capped
								? 'cursor-not-allowed bg-slate-100 text-slate-400'
								: ''}"
						/>
						{#if isOver}
							<p class="text-xs font-semibold text-red-700" role="alert">
								เกินยอดคงเหลือใน Lot ({lot.qty})
							</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if !validation.ok && validation.reason === 'expired_lot'}
			<p class="text-xs font-semibold text-red-700" role="alert">
				ไม่สามารถใช้ Lot ที่หมดอายุแล้วได้
			</p>
		{/if}
	{/if}
</div>
