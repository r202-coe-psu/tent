<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		itemMasterUnit,
		formatUnit,
		useUnitsOfMeasure,
		useItemMasters
	} from '$lib/features/catalog';
	import { useSupplyItems, useThresholdOverrides } from '$lib/features/supply';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { canDistributeStock } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { qtyGt, subQty } from '$lib/utils/qty';
	import { ulid } from '$lib/db/ulid';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import Plus from '@lucide/svelte/icons/plus';
	import {
		projectStockLotBalances,
		StockLotIntegrityError,
		type StockLedger,
		type StockLotBalance
	} from '../domain/operations';
	import { toLotPriorityItems } from '../domain/lot-priority';
	import {
		applyBatchRun,
		checkDistributeBatch,
		emptyDistributeLine,
		hasLandedRows,
		parseDistributeNote,
		planBatchWrites,
		summarizeBatch,
		rankLotsByItem,
		withLineItem,
		type DistributeLineDraft,
		type ReorderPolicy
	} from '../domain/distribute-batch';
	import { DISTRIBUTE_NOTE_MAX, isCustomDestination } from '../domain/distribute-destination';
	import { useDistributeBatch, useStockBalance, useLedger } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import { useDestinationOptions } from '../application/use-destination-options.svelte';
	import { describeBatchResult } from './distribute-result';
	import DistributeLineCard from './distribute-line-card.svelte';
	import DistributeSummary from './distribute-summary.svelte';

	/**
	 * Direct issue of one or more items under one requisition ticket and one destination (#837).
	 * A one-line batch is the single-item flow: the stock table's "เบิก" button opens it with that
	 * item already on line 1. Every ledger row of the batch shares one `ref_id`; a partly written
	 * batch locks the lines that landed and the next save writes only the rest (CR-143 FR-A9).
	 */
	let {
		onsuccess,
		preselectedItemId = undefined,
		occupancy = 0
	}: {
		onsuccess?: (result?: { keepOpen: boolean; summary?: string }) => void;
		preselectedItemId?: string;
		occupancy?: number;
	} = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);
	const roles = $derived(authStore.user?.roles ?? []);
	const canDistribute = $derived(canDistributeStock(roles, getShelterCode()));

	const stockItems = useStockFormItems(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const storagePoints = useStoragePoints(() => getShelterCode());
	// FR-E2: destination chips come from the shelter's own storage points and zones.
	const destinations = useDestinationOptions(() => getShelterCode());
	const destinationOptions = $derived(destinations.options);
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const batchMutation = useDistributeBatch();
	const supplyItemsQuery = useSupplyItems();
	const overridesQuery = useThresholdOverrides();
	// Shelf life / storage type feed the weighted lot order (CR-143 §A). Read from every item
	// master (deactivated ones too, as the stock page does) so a lot sorts the same everywhere (FR-A5).
	const itemMastersQuery = useItemMasters(() => getShelterCode());

	const newRefId = () => `requisition_ticket:direct-${ulid()}`;

	let refId = $state(newRefId());
	let note = $state('');
	// "อื่นๆ" was tapped: the destination is typed by hand, even while the box is still empty.
	let customDestination = $state(false);
	let attempted = $state(false);
	let noteInputEl = $state<HTMLInputElement | null>(null);
	let lines = $state<DistributeLineDraft[]>([emptyDistributeLine(ulid())]);

	const units = $derived(unitsQuery.data ?? []);
	const items = $derived(stockItems.items);
	const itemById = $derived(new Map(items.map((item) => [item._id, item])));
	const balanceByItemId = $derived(balanceQuery.data ?? new Map<string, string>());
	const priorityItems = $derived(toLotPriorityItems(itemMastersQuery.data ?? []));
	const unitLabel = (code: string) => formatUnit(code, units, langState.current) || code;
	const labels = $derived({
		itemName: (id: string) => itemById.get(id)?.name ?? id,
		baseUnitLabel: (id: string) => {
			const item = itemById.get(id);
			return item ? unitLabel(itemMasterUnit(item)) : '';
		}
	});

	const lotProjection = $derived.by((): { lots: StockLotBalance[]; error: string | null } => {
		if (!ledgerQuery.data) return { lots: [], error: null };
		try {
			const lots = projectStockLotBalances(ledgerQuery.data as StockLedger[]).filter((l) =>
				qtyGt(l.qty, 0)
			);
			return { lots, error: null };
		} catch (error) {
			if (!(error instanceof StockLotIntegrityError)) throw error;
			return { lots: [], error: error.message };
		}
	});
	const rankedLotsByItem = $derived(rankLotsByItem(lotProjection.lots, priorityItems, Date.now()));

	const reorderPolicies = $derived.by(() => {
		const overrides = new Map((overridesQuery.data ?? []).map((o) => [o.item_id, o]));
		const asPolicy = (o: NonNullable<ReturnType<typeof overrides.get>>) => ({
			reorder_level: o.reorder_level,
			consumption_rate: o.consumption_rate,
			target_reserve_days: o.target_reserve_days
		});
		const fromSupply = (supplyItemsQuery.data ?? []).map((supply): [string, ReorderPolicy] => {
			const override = overrides.get(supply._id);
			return [
				supply._id,
				{
					item: {
						reorder_level: supply.reorder_level,
						consumption_rate: supply.consumption_rate,
						target_reserve_days: supply.target_reserve_days,
						timeframe: supply.timeframe
					},
					override: override ? asPolicy(override) : null
				}
			];
		});
		const supplied = new Set(fromSupply.map(([id]) => id));
		const overrideOnly = [...overrides]
			.filter(([id]) => !supplied.has(id))
			.map(([id, o]): [string, ReorderPolicy] => [id, { item: {}, override: asPolicy(o) }]);
		return new Map([...fromSupply, ...overrideOnly]);
	});

	const check = $derived(
		checkDistributeBatch(lines, {
			lots: lotProjection.lots,
			packaging: itemById,
			priorityItems,
			reorder: reorderPolicies,
			occupancy,
			now: Date.now()
		})
	);

	const summary = $derived(summarizeBatch(lines, check));
	const takenItemIds = $derived(new Set(lines.map((l) => l.item_id).filter((id) => id !== '')));
	const hasLanded = $derived(lines.some(hasLandedRows));
	const submitting = $derived(batchMutation.isPending);
	const lineDisabled = $derived(offline || !canDistribute || submitting);
	const noteProblem = $derived.by(() => {
		if (!attempted) return null;
		const parsed = parseDistributeNote(note);
		return parsed.ok ? null : parsed.message;
	});

	// What the user must see before confirming: lines that cannot be issued, and lines that will
	// leave the item under its reorder threshold (a warning only, never a block).
	const shortEntries = $derived(
		lines.flatMap((line, index) => {
			const verdict = check.verdicts[index];
			return verdict.kind === 'short' ? [{ line, verdict }] : [];
		})
	);
	const lowEntries = $derived(
		lines.flatMap((line, index) => {
			const verdict = check.verdicts[index];
			return verdict.kind === 'ok' && verdict.lowStock ? [{ line, warning: verdict.lowStock }] : [];
		})
	);
	const unfinishedCount = $derived(
		check.verdicts.filter((v) => v.kind === 'incomplete' || v.kind === 'duplicate').length
	);

	const canSubmit = $derived(!offline && canDistribute && !submitting && check.canSave);

	const submitLabel = $derived.by(() => {
		if (submitting) return 'กำลังบันทึก…';
		if (hasLanded) return `เบิกที่เหลือ ${check.pendingCount} รายการ`;
		const only = lines.length === 1 ? lines[0] : null;
		if (only && only.qty) return `เบิก ${only.qty} ${unitLabel(only.unit)}`;
		return `เบิก ${check.pendingCount} รายการ`;
	});

	function chipClass(active: boolean) {
		return [
			'inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
			active
				? 'border-2 border-[#0284C7] bg-sky-50 text-sky-900'
				: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
		].join(' ');
	}

	const customActive = $derived(customDestination || isCustomDestination(note, destinationOptions));

	function firstLine(): DistributeLineDraft {
		const preselected = preselectedItemId ? itemById.get(preselectedItemId) : undefined;
		const blank = emptyDistributeLine(ulid());
		return preselected ? withLineItem(blank, preselected) : blank;
	}

	function startBatch() {
		refId = newRefId();
		note = '';
		customDestination = false;
		attempted = false;
		lines = [firstLine()];
	}

	// The catalog arrives after mount; put the preselected item on line 1 once, and only while
	// the user has not touched that line.
	let preselectApplied = false;
	$effect(() => {
		if (preselectApplied || !preselectedItemId) return;
		const picked = itemById.get(preselectedItemId);
		if (!picked) return;
		preselectApplied = true;
		untrack(() => {
			if (lines.length === 1 && !lines[0].item_id) lines = [withLineItem(lines[0], picked)];
		});
	});

	function addLine() {
		lines.push(emptyDistributeLine(ulid()));
	}

	function removeLine(key: string) {
		lines = lines.filter((line) => line.key !== key);
		if (lines.length === 0) lines = [emptyDistributeLine(ulid())];
	}

	function setDestination(label: string | null) {
		if (label === null) {
			customDestination = true;
			note = '';
			queueMicrotask(() => noteInputEl?.focus());
			return;
		}
		customDestination = false;
		note = label;
	}

	async function submit(keepOpen: boolean) {
		if (submitting) return;
		attempted = true;
		const parsedNote = parseDistributeNote(note);
		if (!parsedNote.ok) {
			toast.error(parsedNote.message);
			return;
		}
		if (!check.canSave) {
			toast.error('กรุณาตรวจสอบรายการที่มีเครื่องหมายแจ้งเตือน');
			return;
		}

		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};
		const toastId = toast.loading('กำลังบันทึก...');
		let result;
		try {
			result = await batchMutation.mutateAsync({
				lines: planBatchWrites(lines, check),
				ref_id: refId,
				note: parsedNote.value,
				ctx
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', {
				id: toastId
			});
			return;
		}

		// FR-A9: rows already written stay; lock the lines that landed so the next save writes only the rest.
		lines = applyBatchRun(lines, result.outcomes);
		const report = describeBatchResult(lines, labels);
		if (result.complete) {
			toast.success(report.message, { id: toastId, description: report.detail });
			const summary = report.items.map((i) => `${i.name} −${i.qty} ${i.unitLabel}`).join(', ');
			startBatch();
			onsuccess?.({ keepOpen, summary });
			return;
		}
		toast.error(report.message, {
			id: toastId,
			duration: 15000,
			description: report.detail ? `เบิกแล้ว: ${report.detail}` : undefined
		});
	}
</script>

<form
	class="flex min-h-0 flex-1 flex-col"
	onsubmit={(event) => {
		event.preventDefault();
		void submit(true);
	}}
>
	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
		{#if !canDistribute}
			<div
				class="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
				role="alert"
			>
				<AlertTriangle class="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
				<span
					>ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) หรือผู้จัดการศูนย์ (shelter_manager)
					จึงจะเบิกจ่ายได้</span
				>
			</div>
		{/if}

		{#if lotProjection.error}
			<div
				class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
				role="alert"
			>
				คำนวณยอดล็อตไม่ได้ — {lotProjection.error}
			</div>
		{/if}

		{#if hasLanded}
			<div
				class="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
				role="status"
			>
				<p class="flex items-center gap-2 font-semibold">
					<AlertTriangle class="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
					บันทึกไปบางส่วนแล้ว
				</p>
				<p>
					รายการที่เบิกแล้วถูกล็อกไว้และจะไม่ถูกตัดซ้ำ กดปุ่ม "เบิกที่เหลือ"
					เพื่อเบิกเฉพาะรายการที่ยังไม่เสร็จ ในใบเบิกเดิม
				</p>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 self-start"
					disabled={submitting}
					onclick={startBatch}
				>
					ทิ้งรายการที่เหลือและเริ่มชุดใหม่
				</Button>
			</div>
		{/if}

		<div class="flex items-center justify-between gap-2">
			<p class="text-sm font-bold text-foreground">รายการที่เบิก</p>
			<p class="text-xs font-medium text-slate-500 tabular-nums">{lines.length} รายการ</p>
		</div>

		<ul class="flex flex-col gap-3">
			{#each lines as line, index (line.key)}
				<li>
					<DistributeLineCard
						bind:line={lines[index]}
						{index}
						verdict={check.verdicts[index]}
						item={itemById.get(line.item_id) ?? null}
						{items}
						{takenItemIds}
						{balanceByItemId}
						itemsLoading={stockItems.isLoading || balanceQuery.isLoading}
						lotsLoading={ledgerQuery.isLoading}
						itemLots={rankedLotsByItem.get(line.item_id) ?? []}
						{priorityItems}
						storagePoints={storagePoints.points}
						{labels}
						{unitLabel}
						disabled={lineDisabled}
						removable={lines.length > 1}
						onremove={() => removeLine(line.key)}
					/>
				</li>
			{/each}
		</ul>

		<Button
			type="button"
			variant="outline"
			class="min-h-11 w-full sm:w-auto sm:self-start"
			disabled={lineDisabled}
			onclick={addLine}
		>
			<Plus class="h-4 w-4" aria-hidden="true" />
			เพิ่มรายการ
		</Button>

		<DistributeSummary
			{summary}
			{labels}
			{unitLabel}
			storagePoints={storagePoints.points}
			{priorityItems}
		/>

		<div class="space-y-2">
			<Label class="text-sm font-semibold text-slate-700">
				เบิกให้ใคร / ไปที่ไหน (ใช้กับทุกรายการ) <span class="font-bold text-destructive">*</span>
			</Label>
			<div class="flex flex-wrap gap-2" role="group" aria-label="ปลายทาง">
				{#each destinationOptions as preset (preset)}
					<button
						type="button"
						class={chipClass(note === preset)}
						aria-pressed={note === preset}
						disabled={hasLanded || lineDisabled}
						onclick={() => setDestination(preset)}
					>
						{preset}
					</button>
				{/each}
				<button
					type="button"
					class={chipClass(customActive)}
					aria-pressed={customActive}
					disabled={hasLanded || lineDisabled}
					onclick={() => setDestination(null)}
				>
					อื่นๆ...
				</button>
			</div>
			<Input
				bind:ref={noteInputEl}
				bind:value={note}
				placeholder="ปลายทาง / ผู้รับ"
				maxlength={DISTRIBUTE_NOTE_MAX}
				disabled={hasLanded || lineDisabled}
				aria-label="ปลายทาง / ผู้รับ"
				aria-invalid={noteProblem ? 'true' : undefined}
				class="min-h-11"
			/>
			{#if noteProblem}
				<p class="text-sm font-semibold text-red-700" role="alert">{noteProblem}</p>
			{:else if hasLanded}
				<p class="text-xs text-slate-500">
					ปลายทางถูกล็อกไว้ เพราะมีรายการที่บันทึกแล้วในใบเบิกนี้
				</p>
			{/if}
		</div>

		{#if shortEntries.length > 0 || unfinishedCount > 0 || lowEntries.length > 0}
			<div class="flex flex-col gap-2" aria-live="polite">
				{#if shortEntries.length > 0}
					<div
						class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
						role="alert"
					>
						<p class="flex items-center gap-2 font-semibold">
							<AlertTriangle class="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
							เบิกไม่ได้ {shortEntries.length} รายการ — ยอดไม่พอ จึงยังบันทึกไม่ได้
						</p>
						<ul class="mt-1 space-y-0.5 tabular-nums">
							{#each shortEntries as { line, verdict } (line.key)}
								<li>
									{labels.itemName(line.item_id)} · ต้องการ {verdict.requested}
									{labels.baseUnitLabel(line.item_id)} มี {verdict.available}
									(ขาด {subQty(verdict.requested, verdict.available)})
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if unfinishedCount > 0}
					<p class="text-sm font-semibold text-red-700" role="alert">
						มี {unfinishedCount} รายการที่ยังกรอกไม่ครบหรือซ้ำกับรายการอื่น
					</p>
				{/if}
				{#if lowEntries.length > 0}
					<div
						class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
						role="status"
					>
						<p class="flex items-center gap-2 font-bold">
							<AlertTriangle class="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
							ยอดหลังเบิกจะต่ำกว่าเกณฑ์ {lowEntries.length} รายการ
						</p>
						<ul class="mt-1 space-y-0.5 text-xs font-medium text-amber-900/80 tabular-nums">
							{#each lowEntries as { line, warning } (line.key)}
								{@const unit = labels.baseUnitLabel(line.item_id)}
								<li>
									{labels.itemName(line.item_id)} · เหลือ {warning.remaining}
									{unit} (เกณฑ์ {warning.threshold}
									{unit}){#if warning.coverDays !== null}
										· ครอบคลุมประมาณ {warning.coverDays} วัน{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div
		class="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:justify-end sm:px-6"
	>
		<Button
			type="button"
			variant="outline"
			size="lg"
			disabled={!canSubmit}
			class="min-h-11 flex-1 font-bold"
			onclick={() => void submit(true)}
		>
			{submitting ? 'กำลังบันทึก…' : 'บันทึกแล้วเบิกรายการถัดไป'}
		</Button>
		<Button
			type="button"
			size="lg"
			disabled={!canSubmit}
			class="min-h-11 flex-1 font-bold"
			onclick={() => void submit(false)}
		>
			{submitLabel}
		</Button>
	</div>
</form>
