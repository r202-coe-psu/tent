<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import {
		defaultInventoryUom,
		formatUnit,
		shelfLifeExpiryLabel,
		toLedgerQtyUnit,
		useUnitsOfMeasure
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import CheckCircle2 from '@lucide/svelte/icons/circle-check';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { Donation } from '../domain/operations';
	import {
		deriveDonationReceiptLineId,
		donationShortfall,
		type DonationBatchLine
	} from '../domain/donation-batch';
	import {
		draftProblem,
		initialBatchDrafts,
		isReceivedDraft,
		type BatchLineDraft
	} from '../domain/donation-batch-draft';
	import {
		applyExpiryAutofill,
		confirmExpiry,
		editExpiry,
		initialExpiryState,
		todayLocalIso
	} from '../domain/lot-expiry';
	import { storageLotFields, type StoragePointRef } from '../domain/lot-storage';
	import {
		useReceiveDonationBatch,
		useStockBalance,
		useStockLedgers
	} from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import type { StockFormItem } from '../domain/stock-form-items';
	import ItemCombobox from './item-combobox.svelte';
	import StoragePointSelect from './storage-point-select.svelte';

	/**
	 * Batch receive of one donation ticket (CR-143 §B): every line of the ticket is
	 * pulled in for the count, lines can be added or dropped, and the whole receipt is
	 * written at once. A partly written receipt keeps the saved lines locked and offers
	 * a retry of only the ones that failed (FR-B7).
	 */
	let {
		donation,
		onsuccess
	}: {
		donation: Donation;
		/** The donation is `received`; `summary` is a one-line recap for the parent's toast. */
		onsuccess?: (summary: string) => void;
	} = $props();

	const offline = $derived(authStore.needsReauth);

	const stockItems = useStockFormItems(() => getShelterCode());
	const storagePoints = useStoragePoints(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const ledgersQuery = useStockLedgers();
	const balanceQuery = useStockBalance();
	const receiveMutation = useReceiveDonationBatch();

	const units = $derived(unitsQuery.data ?? []);
	const items = $derived(stockItems.items);
	const itemById = $derived(new Map(items.map((item) => [item._id, item])));
	const balanceByItemId = $derived(balanceQuery.data ?? new Map<string, string>());
	const unitLabel = (code: string) => formatUnit(code, units, langState.current) || code;
	const itemName = (id: string) => itemById.get(id)?.name ?? id;

	// The ticket is fixed for the lifetime of this component (the parent keys it by `_id`),
	// so its lines are read once; refetches of the donation must not overwrite the count.
	let lines = $state<BatchLineDraft[]>(untrack(() => initialBatchDrafts(donation)));
	// New lines continue after the ticket's own, so no line ever reuses a number.
	let nextLineNo = $state(untrack(() => donation.items?.length ?? 0));
	let storagePointId = $state('');
	let storagePoint = $state<StoragePointRef | null>(null);
	let attempted = $state(false);
	let transitionError = $state<string | null>(null);
	/** `_id`s of this donation's ledger rows that belong to one of the lines above. */
	let lockedRowIds = $state<string[]>([]);

	const donationRows = $derived(
		(ledgersQuery.data ?? []).filter(
			(row) => row.reason === 'donation' && row.ref_id === donation._id
		)
	);

	/**
	 * A receipt interrupted earlier (reload, another device) left rows in the ledger. Match
	 * them back to their lines by deterministic id and lock those lines — they show what
	 * was recorded and are not written again (FR-B7).
	 */
	let lockRun = 0;
	$effect(() => {
		const rowsById = new Map(donationRows.map((row) => [row._id, row]));
		const targets = lines.map((line) => ({ line, line_no: line.line_no, item_id: line.item_id }));
		const run = ++lockRun;
		void (async () => {
			const matched: string[] = [];
			for (const { line, line_no, item_id } of targets) {
				if (!item_id) continue;
				const id = await deriveDonationReceiptLineId(donation._id, item_id, line_no);
				if (run !== lockRun) return;
				const row = rowsById.get(id);
				if (!row) continue;
				matched.push(id);
				if (!line.locked) {
					line.locked = true;
					line.qty = row.qty;
					line.unit = row.unit;
					line.error = undefined;
				}
			}
			if (run === lockRun) lockedRowIds = matched;
		})();
	});

	/** Rows of this donation that no line accounts for (e.g. lines added before a reload). */
	const otherRecorded = $derived(donationRows.filter((row) => !lockedRowIds.includes(row._id)));

	/** The expiry autofill needs the item's shelf life, which arrives after the catalog loads. */
	$effect(() => {
		const catalog = itemById;
		untrack(() => {
			for (const line of lines) {
				if (line.locked || line.expiry.touched || line.expiry.value) continue;
				refreshAutofill(line, catalog.get(line.item_id) ?? null);
			}
		});
	});

	function refreshAutofill(line: BatchLineDraft, item: StockFormItem | null) {
		line.expiry = applyExpiryAutofill(line.expiry, item, '', todayLocalIso());
	}

	function setExpiry(line: BatchLineDraft, value: string) {
		line.expiry = editExpiry(line.expiry, value);
	}

	function chooseItem(line: BatchLineDraft, item: StockFormItem | null) {
		line.item_id = item?._id ?? '';
		// the donor's unit ("กระป๋อง") means nothing to the catalog: count in the item's own unit
		if (item) line.unit = defaultInventoryUom(item);
		line.expiry = initialExpiryState();
		refreshAutofill(line, item);
		line.error = undefined;
	}

	function addLine() {
		lines.push({
			line_no: nextLineNo,
			item_id: '',
			unit: '',
			qty: '',
			expiry: initialExpiryState(),
			locked: false
		});
		nextLineNo += 1;
	}

	function removeLine(lineNo: number) {
		lines = lines.filter((line) => line.line_no !== lineNo);
	}

	const requires = (line: BatchLineDraft) => itemById.get(line.item_id)?.requiresExpiry ?? false;

	/** qty/unit as the ledger stores them: the item's base unit (schema.md §2.1). */
	function toBase(qty: string, unit: string, itemId: string): { qty: string; unit: string } {
		const item = itemById.get(itemId);
		if (!item || !unit) return { qty, unit };
		try {
			return toLedgerQtyUnit(qty, unit, item);
		} catch {
			// a unit the item does not know: leave it, the repository names the mismatch
			return { qty, unit };
		}
	}

	// FR-B5 — "received less than declared" is derived, never stored.
	const shortfalls = $derived.by(() => {
		const declared = (donation.items ?? []).map((item, index) => {
			const itemId = item.item_id || lines.find((line) => line.line_no === index)?.item_id || '';
			return { item_id: itemId, ...toBase(item.qty, item.unit, itemId) };
		});
		const counted = [
			...lines
				.filter((line) => line.item_id && isReceivedDraft(line))
				.map((line) => ({ item_id: line.item_id, ...toBase(line.qty, line.unit, line.item_id) })),
			...otherRecorded.map((row) => ({ item_id: row.item_id, qty: row.qty }))
		];
		return donationShortfall(declared, counted);
	});

	const failedCount = $derived(lines.filter((line) => !!line.error).length);
	const savedCount = $derived(lines.filter((line) => line.locked).length);
	const receivedCount = $derived(lines.filter((line) => isReceivedDraft(line)).length);

	const submitLabel = $derived.by(() => {
		if (receiveMutation.isPending) return 'กำลังบันทึก…';
		if (transitionError) return 'ลองเปลี่ยนสถานะใบอีกครั้ง';
		if (failedCount > 0) return 'ลองบันทึกเฉพาะรายการที่ไม่สำเร็จ';
		return `บันทึกรับของ ${receivedCount} รายการ`;
	});

	function problemText(line: BatchLineDraft): string | null {
		const problem = attempted ? draftProblem(line, requires(line)) : null;
		if (problem === 'qty') return 'ระบุจำนวนที่รับจริง (ใส่ 0 ถ้าไม่ได้รับ)';
		if (problem === 'item') return 'เลือกสินค้าให้ตรงกับรายการนี้ก่อนบันทึก';
		if (problem === 'expiry') return 'สินค้านี้ต้องระบุวันหมดอายุ';
		return null;
	}

	async function submit() {
		attempted = true;
		if (lines.some((line) => draftProblem(line, requires(line)))) {
			toast.error('กรุณาตรวจสอบรายการที่มีเครื่องหมายแจ้งเตือน');
			return;
		}
		if (!lines.some((line) => isReceivedDraft(line))) {
			toast.error('ไม่มีรายการที่รับจริง — หากไม่ได้รับของ ให้ยกเลิกใบบริจาคแทน');
			return;
		}

		// Saved lines are sent again as they were: the repository finds their rows by id
		// and writes only what is missing, so a retry can never double a row.
		const batch: DonationBatchLine[] = lines
			.filter((line) => line.item_id)
			.map((line) => {
				const base = toBase(line.qty || '0', line.unit, line.item_id);
				const lot = {
					...(line.expiry.value ? { expiry: line.expiry.value } : {}),
					...storageLotFields(storagePoint)
				};
				return {
					line_no: line.line_no,
					item_id: line.item_id,
					qty: base.qty,
					unit: base.unit,
					...(Object.keys(lot).length > 0 ? { lot } : {})
				};
			});

		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'unknown' };
		let result;
		try {
			result = await receiveMutation.mutateAsync({ donation, lines: batch, ctx });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
			return;
		}

		for (const outcome of result.lines) {
			const line = lines.find((candidate) => candidate.line_no === outcome.line_no);
			if (!line) continue;
			if (outcome.state === 'saved') {
				line.locked = true;
				line.error = undefined;
			} else if (outcome.state === 'failed') {
				line.error = outcome.error ?? 'บันทึกไม่สำเร็จ';
			}
		}
		transitionError = result.transitionError ?? null;

		if (result.received) {
			const saved = result.lines.filter((line) => line.state === 'saved').length;
			toast.success('รับของจากใบบริจาคแล้ว');
			onsuccess?.(`${donation.donor.name} · รับเข้า ${saved} รายการ`);
			return;
		}
		if (result.rowsComplete) {
			toast.error('บันทึกสินค้าครบแล้ว แต่ยังเปลี่ยนสถานะใบบริจาคไม่สำเร็จ — กดลองใหม่ได้');
			return;
		}
		const failed = result.lines.filter((line) => line.state === 'failed').length;
		toast.error(`บันทึกไม่สำเร็จ ${failed} รายการ — รายการที่บันทึกแล้วถูกล็อกไว้ กดลองใหม่ได้`);
	}
</script>

<div class="col-span-1 flex flex-col gap-4 sm:col-span-2">
	<div class="flex items-center justify-between gap-2">
		<p class="text-sm font-bold text-foreground">2 · นับของที่ได้รับจริง</p>
		<p class="text-xs font-medium text-slate-500 tabular-nums">
			รับ {receivedCount} รายการ{#if savedCount > 0}
				· บันทึกแล้ว {savedCount}{/if}
		</p>
	</div>

	{#if failedCount > 0 || transitionError}
		<div
			class="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
			role="alert"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
			<div class="space-y-1">
				{#if failedCount > 0}
					<p class="font-semibold">
						บันทึกไม่สำเร็จ {failedCount} รายการ — ใบบริจาคยังไม่เปลี่ยนเป็น "รับแล้ว"
					</p>
					<p>รายการที่บันทึกแล้วถูกล็อกไว้ กดปุ่มด้านล่างเพื่อบันทึกเฉพาะรายการที่ไม่สำเร็จ</p>
				{:else}
					<p class="font-semibold">บันทึกสินค้าครบทุกรายการแล้ว แต่เปลี่ยนสถานะใบบริจาคไม่สำเร็จ</p>
					<p>{transitionError} — กดลองใหม่ ระบบจะไม่บันทึกสินค้าซ้ำ</p>
				{/if}
			</div>
		</div>
	{/if}

	<ul class="flex flex-col gap-3">
		{#each lines as line (line.line_no)}
			{@const problem = problemText(line)}
			<li
				class="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-2xs {line.error
					? 'border-red-200'
					: line.locked
						? 'border-emerald-200'
						: 'border-slate-200/80'}"
			>
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div class="min-w-0 space-y-0.5">
						{#if line.item_id && (line.declared_qty !== undefined || line.locked)}
							<p class="text-base font-bold break-words text-slate-900">{itemName(line.item_id)}</p>
						{/if}
						{#if line.free_text}
							<p class="text-xs font-semibold text-slate-500">ในใบระบุว่า "{line.free_text}"</p>
						{/if}
						<p class="text-xs text-slate-500">
							{#if line.declared_qty !== undefined}
								ในใบ <span class="tabular-nums">{line.declared_qty}</span>
								{unitLabel(line.unit)}
							{:else}
								รายการนอกใบ
							{/if}
						</p>
					</div>
					<div class="flex items-center gap-2">
						{#if line.locked}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
							>
								<CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
								บันทึกแล้ว
							</span>
						{:else}
							{#if line.error}
								<span
									class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900"
								>
									<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
									ไม่สำเร็จ
								</span>
							{/if}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="min-h-11 min-w-11"
								onclick={() => removeLine(line.line_no)}
							>
								<Trash2 class="h-4 w-4" aria-hidden="true" />
								<span class="sr-only">ลบรายการนี้</span>
							</Button>
						{/if}
					</div>
				</div>

				{#if !line.locked && (!line.item_id || line.declared_qty === undefined || line.free_text)}
					<div class="space-y-1.5">
						<Label class="text-sm font-semibold text-slate-700">
							สินค้า <span class="text-red-500">*</span>
						</Label>
						<ItemCombobox
							{items}
							allowCreate
							value={line.item_id}
							isLoading={stockItems.isLoading}
							{balanceByItemId}
							formatBalanceUnit={(item) => unitLabel(item.unit)}
							onSelect={(item) => chooseItem(line, item)}
						/>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="space-y-1.5">
						<Label for="batch-qty-{line.line_no}" class="text-sm font-semibold text-slate-700">
							รับจริง{#if line.unit}
								({unitLabel(line.unit)}){/if}
						</Label>
						<Input
							id="batch-qty-{line.line_no}"
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							placeholder="0"
							value={line.qty}
							oninput={(event) => {
								line.qty = event.currentTarget.value;
								line.error = undefined;
							}}
							onkeydown={(event) => {
								if (event.key === 'Enter') event.preventDefault();
							}}
							disabled={line.locked}
							aria-invalid={problem === 'qty' ? 'true' : undefined}
							class="min-h-11 font-bold tabular-nums"
						/>
					</div>

					{#if !line.locked}
						<div class="space-y-1.5">
							<Label class="text-sm font-semibold text-slate-700">
								วันหมดอายุ
								{#if requires(line)}
									<span class="text-red-500">*</span>
								{:else}
									<span class="font-normal text-slate-500">(ไม่บังคับ)</span>
								{/if}
							</Label>
							<DatePicker
								bind:value={() => line.expiry.value, (value) => setExpiry(line, value)}
								placeholder="วว/ดด/ปปปป"
							/>
						</div>
					{/if}
				</div>

				{#if !line.locked && line.expiry.autoFilled && line.expiry.shelfLifeDays != null}
					<div
						class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
					>
						<span>{shelfLifeExpiryLabel(line.expiry.shelfLifeDays)}</span>
						<Button
							type="button"
							variant="outline"
							class="min-h-11 rounded-lg px-3 text-xs font-bold"
							onclick={() => (line.expiry = confirmExpiry(line.expiry))}
						>
							ตรวจสอบแล้ว
						</Button>
					</div>
				{/if}

				{#if line.error}
					<p class="flex items-start gap-2 text-sm font-semibold text-red-700" role="alert">
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
						<span>{line.error}</span>
					</p>
				{:else if problem}
					<p class="text-sm font-semibold text-red-700" role="alert">{problem}</p>
				{/if}
			</li>
		{/each}
	</ul>

	{#if otherRecorded.length > 0}
		<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-sm text-slate-700">
			<p class="font-semibold">บันทึกเข้าคลังไว้ก่อนหน้านี้ ({otherRecorded.length} รายการ)</p>
			<ul class="mt-1 space-y-0.5">
				{#each otherRecorded as row (row._id)}
					<li class="tabular-nums">{itemName(row.item_id)} · {row.qty} {unitLabel(row.unit)}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<Button type="button" variant="outline" class="min-h-11 w-full sm:w-auto" onclick={addLine}>
		<Plus class="h-4 w-4" aria-hidden="true" />
		เพิ่มรายการนอกใบ
	</Button>

	<div class="space-y-1.5">
		<Label class="text-sm font-semibold text-slate-700">
			สถานที่จัดเก็บ (ใช้กับทุกรายการในใบนี้)
		</Label>
		<StoragePointSelect
			points={storagePoints.points}
			bind:value={storagePointId}
			onchange={(point) => (storagePoint = point)}
		/>
	</div>

	<div
		class="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:-mx-6 sm:-mb-6 sm:px-6"
	>
		{#if shortfalls.length > 0}
			<div
				class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
				role="status"
			>
				<p class="flex items-center gap-2 font-semibold">
					<AlertTriangle class="h-4 w-4 shrink-0" aria-hidden="true" />
					รับไม่ครบ {shortfalls.length} รายการ
				</p>
				<ul class="mt-1 space-y-0.5 tabular-nums">
					{#each shortfalls as short (short.item_id)}
						<li>
							{itemName(short.item_id)} · ขาด {short.short}
							{unitLabel(itemById.get(short.item_id)?.unit ?? '')}
							<span class="text-amber-800">(ใบ {short.declared} · รับ {short.counted})</span>
						</li>
					{/each}
				</ul>
				<p class="mt-1 text-xs text-amber-800">
					ยอดที่ขาดจะไม่ถูกนับเป็นยอดจองหลังบันทึกรับของแล้ว
				</p>
			</div>
		{:else}
			<p class="flex items-center gap-2 text-sm font-semibold text-emerald-800">
				<CheckCircle2 class="h-4 w-4 shrink-0" aria-hidden="true" />
				รับครบตามใบ
			</p>
		{/if}
		<Button
			type="button"
			size="lg"
			disabled={receiveMutation.isPending || offline}
			class="min-h-11 w-full font-bold"
			onclick={submit}
		>
			{submitLabel}
		</Button>
	</div>
</div>
