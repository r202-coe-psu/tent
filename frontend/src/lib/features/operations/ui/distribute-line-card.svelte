<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { itemMasterUnit, itemSelectableUoms, qtyFromBaseUnit } from '$lib/features/catalog';
	import { addQty, persistQty, qtyGt, qtyGte, qtyIsZero, qtyLte, subQty } from '$lib/utils/qty';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import CheckCircle2 from '@lucide/svelte/icons/circle-check';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import {
		availableForLine,
		hasLandedRows,
		withLineItem,
		type DistributeLineDraft,
		type DistributeLineVerdict
	} from '../domain/distribute-batch';
	import { isLotExpired, lotPriorityReason, type LotPriorityItem } from '../domain/lot-priority';
	import { formatLotClockLine } from '../domain/lot-age';
	import { lotDisplayName, type StoragePointRef } from '../domain/lot-storage';
	import type { StockLotBalance } from '../domain/operations';
	import type { StockFormItem } from '../domain/stock-form-items';
	import { describeLineStatus, type BatchReportLabels } from './distribute-result';
	import ItemCombobox from './item-combobox.svelte';

	/**
	 * One line of the batch issue form (#837): item, quantity + unit, lot mode, and the verdict of
	 * the balance check. A line with rows already in the ledger is read-only (done) or keeps only
	 * its quantity editable (partly cut), so a retry never rewrites what landed.
	 */
	let {
		line = $bindable(),
		index,
		verdict,
		item,
		items,
		takenItemIds,
		balanceByItemId,
		itemsLoading,
		lotsLoading,
		itemLots,
		priorityItems,
		storagePoints,
		labels,
		unitLabel,
		disabled,
		removable,
		onremove
	}: {
		line: DistributeLineDraft;
		index: number;
		verdict: DistributeLineVerdict;
		item: StockFormItem | null;
		items: StockFormItem[];
		/** Items chosen on any line; a line may only pick one of its own or a free item. */
		takenItemIds: ReadonlySet<string>;
		balanceByItemId: ReadonlyMap<string, string>;
		itemsLoading: boolean;
		lotsLoading: boolean;
		/** This line's item, in issue order, empty lots already dropped. */
		itemLots: readonly StockLotBalance[];
		priorityItems: ReadonlyMap<string, LotPriorityItem>;
		storagePoints: readonly StoragePointRef[];
		labels: BatchReportLabels;
		unitLabel: (code: string) => string;
		disabled: boolean;
		removable: boolean;
		onremove: () => void;
	} = $props();

	const QTY_CHIPS = [10, 20, 50] as const;

	const locked = $derived(line.status.kind === 'done');
	const landed = $derived(hasLandedRows(line));
	const statusText = $derived(describeLineStatus(line, labels));

	const selectableItems = $derived(
		items.filter((candidate) => candidate._id === line.item_id || !takenItemIds.has(candidate._id))
	);
	const baseUnitLabel = $derived(item ? unitLabel(itemMasterUnit(item)) : '');
	const unitOptions = $derived(item ? itemSelectableUoms(item) : []);
	const selectedUnitLabel = $derived(unitLabel(line.unit) || 'เลือกหน่วย');
	const stock = $derived(item ? (balanceByItemId.get(item._id) ?? '0') : '0');

	const maxBase = $derived(availableForLine(line.lot, itemLots, priorityItems, Date.now()));
	const maxQtyInUnit = $derived.by(() => {
		if (!item || !line.unit) return '0';
		try {
			return qtyFromBaseUnit(maxBase, line.unit, item);
		} catch {
			return maxBase;
		}
	});
	const expiredLots = $derived(
		itemLots.filter((lot) => isLotExpired(lot, Date.now(), priorityItems.get(lot.item_id)))
	);
	const chosenLotRef = $derived(line.lot.mode === 'single' ? line.lot.lot_ref : '');
	const activeLot = $derived(itemLots.find((lot) => lot.lot_ref === chosenLotRef));

	function chipClass(active: boolean) {
		return [
			'inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
			active
				? 'border-2 border-[#0284C7] bg-sky-50 text-sky-900'
				: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
		].join(' ');
	}

	function lotName(lot: StockLotBalance): string {
		return lotDisplayName(lot.lot, storagePoints);
	}

	function lotLabel(lot: StockLotBalance): string {
		return `${lotName(lot)} · คงเหลือ ${lot.qty} ${baseUnitLabel}`;
	}

	function setQty(value: string) {
		try {
			line.qty = persistQty(qtyGt(value, maxQtyInUnit) ? maxQtyInUnit : value);
		} catch {
			line.qty = value;
		}
	}

	function stepQty(delta: number) {
		const typed = line.qty.trim();
		const current = typed !== '' && !Number.isNaN(Number(typed)) ? typed : '0';
		const next = delta >= 0 ? addQty(current, delta) : subQty(current, Math.abs(delta));
		if (qtyLte(next, 0)) {
			line.qty = '';
			return;
		}
		setQty(next);
	}

	function chooseSingleLot() {
		// An expired lot is never picked automatically (CR-143 FR-A4): it must be adjusted out.
		const now = Date.now();
		const first = itemLots.find((lot) => !isLotExpired(lot, now, priorityItems.get(lot.item_id)));
		line.lot = { mode: 'single', lot_ref: first?.lot_ref ?? '' };
	}

	const shortfall = $derived(
		verdict.kind === 'short' ? subQty(verdict.requested, verdict.available) : '0'
	);
</script>

<div
	class="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-2xs {line.status.kind ===
	'failed'
		? 'border-red-200'
		: locked
			? 'border-emerald-200'
			: 'border-slate-200/80'}"
>
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0 space-y-0.5">
			<p class="text-xs font-semibold text-slate-500 tabular-nums">รายการที่ {index + 1}</p>
			{#if locked || landed}
				<p class="text-base font-bold break-words text-slate-900">
					{labels.itemName(line.item_id)}
				</p>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if locked}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
				>
					<CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
					เบิกแล้ว
				</span>
			{:else if line.status.kind === 'failed'}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900"
				>
					<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
					{landed ? 'ตัดบางส่วน' : 'ไม่สำเร็จ'}
				</span>
			{/if}
			{#if removable && !landed}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="min-h-11 min-w-11"
					{disabled}
					onclick={onremove}
				>
					<Trash2 class="h-4 w-4" aria-hidden="true" />
					<span class="sr-only">ลบรายการที่ {index + 1}</span>
				</Button>
			{/if}
		</div>
	</div>

	{#if locked}
		<p class="text-sm font-medium text-emerald-900 tabular-nums">{statusText}</p>
	{:else}
		{#if !landed}
			<div class="space-y-1.5">
				<Label for="distribute-item-{line.key}" class="text-sm font-semibold text-slate-700">
					สินค้า <span class="text-red-500">*</span>
				</Label>
				<ItemCombobox
					id="distribute-item-{line.key}"
					items={selectableItems}
					allowCreate
					value={line.item_id}
					{disabled}
					isLoading={itemsLoading}
					{balanceByItemId}
					disableWhenEmpty={true}
					formatBalanceUnit={(candidate) => unitLabel(candidate.unit) || candidate.unit}
					onSelect={(picked) => (line = withLineItem(line, picked))}
				/>
			</div>
		{/if}

		{#if item}
			<div
				class="flex items-center justify-between rounded-xl border border-border/50 bg-muted/50 p-3"
			>
				<span class="text-sm text-muted-foreground">คงเหลือ</span>
				<span
					class="text-sm font-bold tabular-nums {!qtyIsZero(stock) && qtyGte(stock, 0)
						? 'text-primary'
						: 'text-destructive'}"
				>
					{stock}
					{baseUnitLabel}
				</span>
			</div>

			<div class="space-y-2">
				<Label for="distribute-qty-{line.key}" class="text-sm font-semibold text-slate-700">
					จำนวน <span class="text-red-500">*</span>
				</Label>
				<div class="flex flex-wrap items-stretch gap-2">
					<div
						class="flex min-w-40 flex-1 items-stretch overflow-hidden rounded-lg border border-input"
					>
						<Button
							type="button"
							variant="ghost"
							class="h-auto min-h-11 rounded-none px-3"
							onclick={() => stepQty(-1)}
							{disabled}
						>
							<Minus class="h-4 w-4" aria-hidden="true" />
							<span class="sr-only">ลดจำนวน</span>
						</Button>
						<Input
							id="distribute-qty-{line.key}"
							type="number"
							inputmode="decimal"
							placeholder="0"
							min="0.01"
							step="any"
							value={line.qty}
							oninput={(event) => (line.qty = event.currentTarget.value)}
							onkeydown={(event) => {
								if (event.key === 'Enter') event.preventDefault();
							}}
							{disabled}
							class="min-h-11 min-w-0 flex-1 rounded-none border-0 border-x border-input font-bold tabular-nums shadow-none focus-visible:ring-0"
						/>
						<Button
							type="button"
							variant="ghost"
							class="h-auto min-h-11 rounded-none px-3"
							onclick={() => stepQty(1)}
							{disabled}
						>
							<Plus class="h-4 w-4" aria-hidden="true" />
							<span class="sr-only">เพิ่มจำนวน</span>
						</Button>
					</div>

					<div class="w-28 shrink-0 sm:w-32">
						{#if unitOptions.length <= 1 || landed}
							<Input
								value={selectedUnitLabel}
								readonly
								disabled
								aria-label="หน่วย"
								class="min-h-11"
							/>
						{:else}
							<Select.Root
								type="single"
								value={line.unit}
								onValueChange={(value) => {
									if (value) line.unit = value;
								}}
								{disabled}
							>
								<Select.Trigger
									aria-label="หน่วย"
									class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-medium"
								>
									{selectedUnitLabel}
								</Select.Trigger>
								<Select.Content>
									{#each unitOptions as option (option.code)}
										<Select.Item
											value={option.code}
											label={unitLabel(option.code) || option.code}
										/>
									{/each}
								</Select.Content>
							</Select.Root>
						{/if}
					</div>
				</div>
				{#if !landed}
					<div class="flex flex-wrap gap-2 pt-1">
						{#each QTY_CHIPS as chip (chip)}
							<button
								type="button"
								class={chipClass(line.qty === String(chip))}
								{disabled}
								onclick={() => setQty(String(chip))}
							>
								{chip}
							</button>
						{/each}
						<button
							type="button"
							class={chipClass(line.qty === maxQtyInUnit && qtyGt(maxQtyInUnit, 0))}
							disabled={disabled || qtyLte(maxQtyInUnit, 0)}
							onclick={() => setQty(maxQtyInUnit)}
						>
							ทั้งหมด ({maxQtyInUnit})
						</button>
					</div>
				{/if}
			</div>

			<div class="space-y-2">
				<p class="text-sm font-semibold text-slate-700">ล็อต</p>
				{#if lotsLoading}
					<p class="text-xs text-muted-foreground">กำลังโหลดล็อต…</p>
				{:else if itemLots.length === 0}
					<p
						class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
						role="alert"
					>
						ไม่พบล็อตที่มีคงเหลือ
					</p>
				{:else}
					<div class="flex flex-wrap gap-2" role="group" aria-label="วิธีเลือกล็อต">
						<button
							type="button"
							class={chipClass(line.lot.mode === 'auto')}
							aria-pressed={line.lot.mode === 'auto'}
							{disabled}
							onclick={() => (line.lot = { mode: 'auto' })}
						>
							ตัดหลายล็อตอัตโนมัติ
						</button>
						<button
							type="button"
							class={chipClass(line.lot.mode === 'single')}
							aria-pressed={line.lot.mode === 'single'}
							{disabled}
							onclick={chooseSingleLot}
						>
							เลือกล็อตเอง
						</button>
					</div>
					{#if line.lot.mode === 'single'}
						<Select.Root
							type="single"
							value={chosenLotRef}
							onValueChange={(value) => (line.lot = { mode: 'single', lot_ref: value })}
							{disabled}
						>
							<Select.Trigger
								aria-label="ล็อต"
								class="min-h-11 w-full rounded-md border border-input bg-white px-3 py-2 text-left text-sm font-medium whitespace-normal data-[size=default]:h-auto"
							>
								<span class="min-w-0 flex-1 text-left break-words">
									{activeLot ? lotLabel(activeLot) : 'เลือกล็อต'}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each itemLots as lot (lot.lot_ref)}
									{@const clocks = formatLotClockLine(lot)}
									<Select.Item value={lot.lot_ref} label={lotLabel(lot)} class="min-h-11 py-2">
										<span class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
											<span class="break-words">{lotLabel(lot)}</span>
											{#if clocks}
												<span class="text-xs font-normal break-words text-muted-foreground">
													{clocks}
												</span>
											{/if}
										</span>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						{#if activeLot}
							{@const clocks = formatLotClockLine(activeLot)}
							{#if clocks}
								<p class="text-xs text-muted-foreground">{clocks}</p>
							{/if}
							<p class="text-xs font-medium text-muted-foreground">
								{lotPriorityReason(activeLot, priorityItems.get(activeLot.item_id), Date.now())}
							</p>
						{/if}
					{:else}
						<div
							class="space-y-2 rounded-xl border border-sky-200 bg-white p-3 shadow-2xs"
							aria-live="polite"
						>
							<p class="text-sm font-semibold text-sky-900">แผนการตัดล็อต</p>
							{#if verdict.kind === 'ok'}
								<ol class="space-y-1.5">
									{#each verdict.plan.allocations as allocation, position (allocation.lot_ref)}
										<li
											class="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
										>
											<div class="min-w-0">
												<p class="text-sm font-semibold text-slate-900">
													{position + 1}. {lotName(allocation.lot)}
												</p>
												<p class="text-xs text-slate-600">
													{lotPriorityReason(
														allocation.lot,
														priorityItems.get(allocation.lot.item_id),
														Date.now()
													)}
												</p>
											</div>
											<p
												class="shrink-0 text-sm font-bold text-slate-900 tabular-nums sm:text-right"
											>
												−{allocation.qty}
												{baseUnitLabel}
												<span class="block text-xs font-medium text-slate-500">
													จากคงเหลือ {allocation.lot.qty}
												</span>
											</p>
										</li>
									{/each}
								</ol>
								<p class="text-sm font-medium text-slate-700 tabular-nums">
									รวม {verdict.plan.planned}
									{baseUnitLabel} · {verdict.plan.allocations.length} แถวในบัญชีสต็อก
								</p>
							{:else}
								<p class="text-sm text-slate-600">
									ใส่จำนวน แล้วระบบจะแบ่งตัดตามลำดับความสำคัญของล็อต (ใกล้หมดอายุ/อยู่ในคลังนานก่อน)
								</p>
							{/if}
							{#if expiredLots.length > 0}
								<div
									class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
									role="status"
								>
									<AlertTriangle
										class="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
										aria-hidden="true"
									/>
									<span>ข้าม {expiredLots.length} ล็อตที่หมดอายุแล้ว — ให้ปรับยอดออกจากคลัง</span>
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		{#if verdict.kind === 'duplicate'}
			<p
				class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900"
				role="alert"
			>
				<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
				<span>สินค้านี้อยู่ในรายการก่อนหน้าแล้ว — รวมจำนวนไว้ในรายการเดียว หรือเลือกสินค้าอื่น</span
				>
			</p>
		{:else if verdict.kind === 'short'}
			<p
				class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900 tabular-nums"
				role="alert"
			>
				<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
				<span>
					{line.lot.mode === 'single' ? 'ยอดคงเหลือในล็อตนี้ไม่พอ' : 'ยอดที่ใช้ได้ไม่พอ'} — มี {verdict.available}
					{baseUnitLabel} ขาดอีก {shortfall}
					{baseUnitLabel} จึงยังบันทึกไม่ได้
				</span>
			</p>
		{:else if verdict.kind === 'incomplete' && verdict.missing === 'unit'}
			<p class="text-sm font-semibold text-red-700" role="alert">
				หน่วยที่เลือกไม่ถูกต้องสำหรับสินค้านี้
			</p>
		{:else if verdict.kind === 'incomplete' && verdict.missing === 'lot' && line.lot.mode === 'single'}
			<p class="text-sm font-semibold text-red-700" role="alert">
				กรุณาเลือกล็อตที่ต้องการเบิกจ่าย
			</p>
		{/if}

		{#if line.status.kind === 'failed' && statusText}
			<p class="flex items-start gap-2 text-sm font-semibold text-red-700" role="alert">
				<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<span>{statusText}</span>
			</p>
		{/if}
	{/if}
</div>
