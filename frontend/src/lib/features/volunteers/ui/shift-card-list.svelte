<script lang="ts">
	/**
	 * Sub-shifts as a list of editable cards (#624), shared by the job create/edit
	 * form and the job detail "Shifts Generator" so both behave the same:
	 * "+ เพิ่มกะ" appends a card that copies the previous card's times and
	 * headcount, the Batch Generator appends a card per generated day, and every
	 * card shows its own error.
	 *
	 * A card's error appears once that card has been edited, or for every card
	 * after the parent sets `showAllErrors` (a save attempt) — so a fresh, empty
	 * card is not red before the user has touched it. The parent runs the same
	 * `shiftCardErrors` to decide whether it may save.
	 */
	import { toast } from 'svelte-sonner';
	import { SvelteSet } from 'svelte/reactivity';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Zap from '@lucide/svelte/icons/zap';
	import ShiftCard from './shift-card.svelte';
	import ShiftBatchGenerator from './shift-batch-generator.svelte';
	import type { JobShift } from '../domain/job.schema';
	import { totalShiftQuota } from '../domain/job.schema';
	import { appendShifts, isDuplicateShift } from '../domain/shift-batch';
	import { newShiftCard, shiftCardErrors, updateShiftCard } from '../domain/shift-draft';

	let {
		shifts = $bindable([]),
		existing = [],
		minQuotaById = {},
		showAllErrors = false,
		idFactory,
		disabled = false,
		emptyHint = 'ยังไม่มีกะย่อย — กด "เพิ่มกะ" หรือสร้างเป็นช่วงวัน'
	}: {
		shifts?: JobShift[];
		/** Shifts already saved on the job when these cards are new additions. */
		existing?: readonly JobShift[];
		/** Seats each saved shift already holds — its headcount floor, and it cannot be removed. */
		minQuotaById?: Readonly<Record<string, number>>;
		showAllErrors?: boolean;
		idFactory: () => string;
		disabled?: boolean;
		emptyHint?: string;
	} = $props();

	const touched = new SvelteSet<string>();
	let showBatch = $state(false);

	const errors = $derived(shiftCardErrors(shifts, { existing, minQuotaById }));
	const totalSeats = $derived(totalShiftQuota(shifts));
	const heldCount = $derived(shifts.filter((s) => (minQuotaById[s.id] ?? 0) > 0).length);

	function change(
		id: string,
		patch: Partial<Pick<JobShift, 'date' | 'start_time' | 'end_time' | 'quota'>>
	) {
		touched.add(id);
		shifts = shifts.map((s) => (s.id === id ? updateShiftCard(s, patch) : s));
	}

	function add() {
		shifts = [...shifts, newShiftCard(shifts.at(-1), idFactory())];
	}

	function remove(id: string) {
		const held = minQuotaById[id] ?? 0;
		if (held > 0) {
			const index = shifts.findIndex((s) => s.id === id);
			toast.error(
				`ลบกะที่ ${index + 1} ไม่ได้ — มีอาสาถือที่นั่งอยู่ ${held} คน ให้ยกเลิกการมอบหมายในหน้ารายละเอียดงานก่อน`
			);
			return;
		}
		touched.delete(id);
		shifts = shifts.filter((s) => s.id !== id);
	}

	function clearAll() {
		const kept = shifts.filter((s) => (minQuotaById[s.id] ?? 0) > 0);
		shifts = kept;
		touched.clear();
		if (kept.length > 0) {
			toast.warning(`เก็บกะที่มีอาสาถือที่นั่งไว้ ${kept.length} กะ — ลบกะเหล่านี้ไม่ได้`);
		}
	}

	function appendGenerated(rows: JobShift[]) {
		const fresh = rows.filter((row) => !isDuplicateShift(row, existing));
		const { shifts: merged, added } = appendShifts(shifts, fresh);
		const skipped = rows.length - added;
		if (added === 0) {
			toast.warning('กะที่สร้างซ้ำกับกะที่มีอยู่แล้วทั้งหมด — ไม่ได้เพิ่มกะใหม่');
			return;
		}
		shifts = merged;
		showBatch = false;
		toast.success(
			skipped > 0 ? `เพิ่ม ${added} กะ (ข้ามที่ซ้ำ ${skipped} กะ)` : `เพิ่ม ${added} กะแล้ว`
		);
	}
</script>

<div class="space-y-3">
	{#if shifts.length === 0}
		<p
			class="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500"
		>
			{emptyHint}
		</p>
	{/if}

	{#each shifts as shift, index (shift.id)}
		<ShiftCard
			{shift}
			{index}
			error={showAllErrors || touched.has(shift.id) ? errors[shift.id] : null}
			minQuota={minQuotaById[shift.id] ?? 0}
			{disabled}
			onchange={(patch) => change(shift.id, patch)}
			onremove={() => remove(shift.id)}
		/>
	{/each}

	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
		<button
			type="button"
			onclick={add}
			{disabled}
			class="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-domain-volunteer-border bg-domain-volunteer-subtle py-3 font-bold text-domain-volunteer-text transition-colors hover:bg-domain-volunteer-border/40 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		>
			<PlusCircle class="h-5 w-5" />
			เพิ่มกะ
		</button>
		<button
			type="button"
			onclick={() => (showBatch = !showBatch)}
			{disabled}
			aria-expanded={showBatch}
			class="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		>
			<Zap class="h-4.5 w-4.5" />
			{showBatch ? 'ปิดตัวสร้างกะเป็นช่วงวัน' : 'สร้างกะเป็นช่วงวัน'}
		</button>
	</div>

	{#if showBatch}
		<ShiftBatchGenerator {idFactory} {disabled} ongenerate={appendGenerated} />
	{/if}

	{#if shifts.length > 0}
		<div class="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
			<span class="tabular-nums">
				{shifts.length} กะ · รวมจำนวนรับ
				<span class="font-semibold text-slate-900">{totalSeats}</span> คน
			</span>
			{#if shifts.length > heldCount}
				<button
					type="button"
					class="min-h-11 font-medium text-red-700 hover:underline disabled:opacity-50"
					{disabled}
					onclick={clearAll}
				>
					ลบทั้งหมด
				</button>
			{/if}
		</div>
	{/if}
</div>
