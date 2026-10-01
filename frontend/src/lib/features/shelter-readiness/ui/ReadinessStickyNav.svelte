<script lang="ts">
	import type { ReadinessSectionId, ReadinessSummaryTally } from '../domain/readiness.types';
	import { READINESS_SECTIONS } from '../domain/readiness-catalog';
	import { Button } from '$lib/components/ui/button';
	import Save from '@lucide/svelte/icons/save';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	interface Props {
		summary: ReadinessSummaryTally;
		savingDraft?: boolean;
		readOnly?: boolean;
		onSaveDraft: () => void;
		onScrollToSection: (sectionId: ReadinessSectionId) => void;
	}

	let {
		summary,
		savingDraft = false,
		readOnly = false,
		onSaveDraft,
		onScrollToSection
	}: Props = $props();

	const progressPercent = $derived(
		summary.total_items > 0 ? Math.round((summary.answered_items / summary.total_items) * 100) : 0
	);
</script>

<div
	class="sticky top-16 z-20 w-full space-y-2.5 rounded-2xl border border-slate-200/90 bg-white/95 p-3 shadow-2xs backdrop-blur-xs sm:p-4"
>
	<!-- บรรทัดที่ 1: หมวดหมู่คำถาม (Section Nav) + ปุ่มบันทึกแบบร่าง -->
	<div class="flex flex-wrap items-center justify-between gap-2.5">
		<!-- Section Jump Buttons -->
		<div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
			{#each READINESS_SECTIONS as section, idx (section.id)}
				<button
					type="button"
					onclick={() => onScrollToSection(section.id)}
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900"
				>
					<span
						class="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-3xs font-bold text-slate-700"
					>
						{idx + 1}
					</span>
					<span>{section.shortLabel}</span>
				</button>
			{/each}
		</div>

		<!-- Action: บันทึกแบบร่าง -->
		{#if !readOnly}
			<Button
				variant="outline"
				size="sm"
				onclick={onSaveDraft}
				disabled={savingDraft}
				class="h-8 shrink-0 gap-1.5 border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
			>
				{#if savingDraft}
					<Loader2 class="size-3.5 animate-spin" />
					<span>กำลังบันทึก...</span>
				{:else}
					<Save class="size-3.5" />
					<span>บันทึกแบบร่าง</span>
				{/if}
			</Button>
		{/if}
	</div>

	<!-- เส้นแบ่งบางๆ ให้ดูเป็นสัดส่วน -->
	<div class="border-t border-slate-100"></div>

	<!-- บรรทัดที่ 2: สรุปยอดผลการตรวจ (Tallies) + แถบความคืบหน้า (Progress) -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<!-- Tally Badges -->
		<div class="flex flex-wrap items-center gap-1.5 text-2xs font-medium">
			<span
				class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800"
			>
				มีครบ: <strong class="text-xs tabular-nums">{summary.fully_ready_count}</strong>
			</span>
			<span
				class="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800"
			>
				มีบางส่วน: <strong class="text-xs tabular-nums">{summary.partial_count}</strong>
			</span>
			<span
				class="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-800"
			>
				ไม่มี: <strong class="text-xs tabular-nums">{summary.none_count}</strong>
			</span>
			{#if summary.unassessed_count > 0}
				<span
					class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-600"
				>
					ยังไม่ตรวจ: <strong class="text-xs tabular-nums">{summary.unassessed_count}</strong>
				</span>
			{/if}
		</div>

		<!-- Progress Indicator -->
		<div class="flex items-center gap-2.5 text-xs font-semibold text-slate-700 tabular-nums">
			<span>ตรวจแล้ว {summary.answered_items}/{summary.total_items} ({progressPercent}%)</span>
			<div
				class="h-2 w-24 overflow-hidden rounded-full border border-slate-200 bg-slate-100 sm:w-32"
			>
				<div
					class="h-full bg-sky-600 transition-all duration-300"
					style="width: {progressPercent}%"
				></div>
			</div>
		</div>
	</div>
</div>
