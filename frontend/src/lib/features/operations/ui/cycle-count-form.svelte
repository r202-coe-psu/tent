<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';
	import { toast } from 'svelte-sonner';
	import { ulid } from '$lib/db/ulid';
	import { useLedger, useApplyCycleCount } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import {
		buildCycleCountLots,
		classifyCycleCount,
		cycleCountVariance,
		groupLotsByStorage,
		planCycleCount,
		summarizeCycleCount,
		type CycleCountEntry,
		type CycleCountLineResult
	} from '../domain/cycle-count';
	import { ADJUST_NOTE_MAX_LENGTH, type StockLedger } from '../domain/operations';

	let {
		onsuccess
	}: {
		onsuccess?: (result?: { keepOpen: boolean; summary?: string }) => void;
	} = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	const stockItems = useStockFormItems(() => getShelterCode());
	const ledgerQuery = useLedger();
	const storagePoints = useStoragePoints(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const applyMutation = useApplyCycleCount();

	const itemsById = $derived(new Map(stockItems.items.map((i) => [i._id, i])));
	const groups = $derived(
		groupLotsByStorage(
			buildCycleCountLots((ledgerQuery.data ?? []) as StockLedger[]),
			storagePoints.points
		)
	);

	/**
	 * The walk in progress. System quantities are frozen when a storage point is picked, so a
	 * movement that lands mid-count neither shifts the variance under the counter's hands nor
	 * changes the deltas a retry sends (the row ids stay valid).
	 */
	let activeGroupLabel = $state<string | null>(null);
	let entries = $state<CycleCountEntry[]>([]);
	let countId = $state(ulid());
	let note = $state('');
	let failures = $state<CycleCountLineResult[]>([]);

	const summary = $derived(summarizeCycleCount(entries));
	const submission = $derived(planCycleCount(entries, countId, note));
	const isSaving = $derived(applyMutation.isPending);
	const canSave = $derived(
		!offline && !isSaving && summary.invalid === 0 && submission.lines.length > 0
	);

	function itemName(itemId: string): string {
		return itemsById.get(itemId)?.name ?? itemId;
	}

	function unitLabel(entry: Pick<CycleCountEntry, 'unit'>): string {
		return formatUnit(entry.unit, unitsQuery.data ?? [], langState.current) || entry.unit;
	}

	function formatExpiry(expiry: string | undefined): string {
		if (!expiry) return 'ไม่ระบุวันหมดอายุ';
		const date = new Date(expiry);
		if (Number.isNaN(date.getTime())) return expiry;
		const label = date.toLocaleDateString('th-TH', {
			day: '2-digit',
			month: 'short',
			year: '2-digit'
		});
		return date.getTime() <= Date.now() ? `หมดอายุแล้ว ${label}` : `หมดอายุ ${label}`;
	}

	function startCount(storageKey: string) {
		const group = groups.find((g) => g.storage_key === storageKey);
		if (!group) return;
		activeGroupLabel = group.label;
		entries = group.lots
			.map((lot) => ({ ...lot, counted_qty: '' }))
			.sort((a, b) => itemName(a.item_id).localeCompare(itemName(b.item_id), 'th'));
		countId = ulid();
		note = '';
		failures = [];
	}

	function leaveCount() {
		activeGroupLabel = null;
		entries = [];
		failures = [];
	}

	/** Pre-fill "nothing wrong" so only the lots that differ need typing. */
	function fillRemainingWithSystem() {
		for (const entry of entries) {
			if (entry.counted_qty.trim() === '') entry.counted_qty = entry.system_qty;
		}
	}

	function stateClass(entry: CycleCountEntry): string {
		switch (classifyCycleCount(entry)) {
			case 'match':
				return 'border-emerald-500/30 bg-emerald-50/50';
			case 'over':
				return 'border-sky-500/40 bg-sky-50';
			case 'short':
				return 'border-rose-500/30 bg-rose-50';
			case 'invalid':
				return 'border-destructive bg-destructive/5';
			default:
				return 'border-border/60 bg-white';
		}
	}

	function varianceLabel(entry: CycleCountEntry): string {
		const variance = cycleCountVariance(entry);
		if (variance === null) return classifyCycleCount(entry) === 'invalid' ? 'ตัวเลขไม่ถูกต้อง' : '';
		const state = classifyCycleCount(entry);
		if (state === 'match') return 'ตรงกับระบบ';
		return state === 'over' ? `เกิน +${variance}` : `ขาด ${variance}`;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSave) return;

		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};
		try {
			const result = await applyMutation.mutateAsync({ submission, ctx });
			if (!result.complete) {
				failures = result.lines.filter((l) => l.state === 'failed');
				toast.error(
					`บันทึกสำเร็จ ${result.lines.length - failures.length}/${result.lines.length} รายการ — กดบันทึกอีกครั้งเพื่อส่งรายการที่เหลือ`
				);
				return;
			}
			const label = activeGroupLabel ?? 'จุดเก็บ';
			toast.success(`บันทึกผลตรวจนับ ${label} แล้ว (${result.lines.length} รายการไม่ตรง)`);
			onsuccess?.({
				keepOpen: true,
				summary: `ตรวจนับ ${label}: ปรับ ${result.lines.length} รายการ`
			});
			leaveCount();
		} catch (err) {
			// Validation failed before anything was written — the count stays as keyed.
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกผลตรวจนับ');
		}
	}
</script>

{#if activeGroupLabel === null}
	<div class="flex flex-col gap-3">
		<p class="text-sm text-muted-foreground">
			เลือกจุดเก็บที่จะเดินตรวจนับ แล้วกรอกจำนวนที่นับได้จริงของทุกล็อต — บันทึกครั้งเดียว
			ระบบจะปรับเฉพาะรายการที่ไม่ตรง
		</p>
		{#if ledgerQuery.isLoading}
			<p class="text-sm text-muted-foreground">กำลังโหลดยอดคงคลัง…</p>
		{:else if groups.length === 0}
			<p class="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
				ยังไม่มีล็อตที่มีของคงเหลือให้ตรวจนับ
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each groups as group (group.storage_key)}
					<li>
						<button
							type="button"
							class="flex min-h-14 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-left hover:border-slate-400 disabled:opacity-50"
							disabled={offline}
							onclick={() => startCount(group.storage_key)}
						>
							<span class="font-semibold text-slate-900">{group.label}</span>
							<span class="text-sm text-muted-foreground">{group.lots.length} ล็อต</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else}
	<form onsubmit={handleSubmit} class="flex flex-col space-y-4">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-xs font-semibold text-muted-foreground">จุดเก็บที่กำลังตรวจนับ</p>
				<p class="text-lg font-bold text-slate-900">{activeGroupLabel}</p>
			</div>
			<Button type="button" variant="outline" class="min-h-11" onclick={leaveCount}>
				เปลี่ยนจุดเก็บ
			</Button>
		</div>

		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-muted/40 px-3 py-2 text-sm"
			aria-live="polite"
		>
			<span>นับแล้ว <strong>{summary.counted}/{summary.total}</strong></span>
			<span class="text-rose-600">ไม่ตรง <strong>{summary.mismatched}</strong></span>
			{#if summary.invalid > 0}
				<span class="text-destructive">กรอกผิด <strong>{summary.invalid}</strong></span>
			{/if}
			<Button
				type="button"
				variant="link"
				class="ml-auto h-auto min-h-11 p-0 text-sm"
				onclick={fillRemainingWithSystem}
			>
				ที่เหลือตรงตามระบบ
			</Button>
		</div>

		<ul class="flex flex-col gap-2">
			{#each entries as entry (`${entry.item_id}::${entry.lot_key}`)}
				{@const inputId = `count-${entry.item_id}-${entry.lot_key}`}
				<li class={['rounded-xl border p-3', stateClass(entry)]}>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<label
								for={inputId}
								class="block font-semibold [overflow-wrap:anywhere] break-words text-slate-900"
							>
								{itemName(entry.item_id)}
							</label>
							<p class="text-xs text-muted-foreground">{formatExpiry(entry.lot.expiry)}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								ในระบบ <span class="font-mono font-bold text-foreground">{entry.system_qty}</span>
								{unitLabel(entry)}
							</p>
						</div>
						<div class="relative w-32 shrink-0">
							<Input
								id={inputId}
								type="text"
								inputmode="decimal"
								placeholder="นับได้"
								autocomplete="off"
								bind:value={entry.counted_qty}
								aria-invalid={classifyCycleCount(entry) === 'invalid'}
								class="min-h-11 bg-white pr-12 font-mono text-base font-bold"
							/>
							<span
								class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs font-bold text-muted-foreground"
							>
								{unitLabel(entry)}
							</span>
						</div>
					</div>
					{#if varianceLabel(entry)}
						<p class="mt-2 text-xs font-semibold">{varianceLabel(entry)}</p>
					{/if}
				</li>
			{/each}
		</ul>

		<Field.Root>
			<Field.Label for="cycle-count-note">
				หมายเหตุ <span class="font-normal text-muted-foreground"
					>(ไม่บังคับ ใช้กับทุกรายการที่ปรับ)</span
				>
			</Field.Label>
			<Textarea
				id="cycle-count-note"
				bind:value={note}
				maxlength={ADJUST_NOTE_MAX_LENGTH}
				rows={2}
				class="min-h-11"
			/>
		</Field.Root>

		{#if failures.length > 0}
			<div
				class="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
				role="alert"
			>
				<p class="font-semibold text-destructive">บันทึกไม่สำเร็จ {failures.length} รายการ</p>
				<ul class="mt-1 list-disc pl-5">
					{#each failures as failure (failure.ledger_id)}
						<li>{itemName(failure.item_id)} — {failure.error}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div
			class="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:-mx-6 sm:-mb-6 sm:px-6"
		>
			<Button type="submit" size="lg" disabled={!canSave} class="min-h-11 w-full font-bold">
				{#if isSaving}
					กำลังบันทึก…
				{:else if submission.lines.length === 0}
					ยังไม่มีรายการที่ไม่ตรง
				{:else}
					บันทึกผลตรวจนับ ({submission.lines.length} รายการที่ไม่ตรง)
				{/if}
			</Button>
		</div>
	</form>
{/if}
