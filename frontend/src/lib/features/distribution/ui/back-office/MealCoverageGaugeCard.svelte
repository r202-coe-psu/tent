<script lang="ts">
	import Gauge from '@lucide/svelte/icons/gauge';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		COVERAGE_STATUS_TONES,
		coverageFilterLabels,
		coverageStatusLabels,
		donutSegments,
		type CoverageStatus
	} from '../model/meal-coverage-view';

	interface Props {
		/** People judged: complete + partial + none. */
		present: number;
		complete: number;
		partial: number;
		none: number;
		/** The report covers several days: the legend words the one-meal status for a range. */
		multiDay: boolean;
	}

	let { present, complete, partial, none, multiDay }: Props = $props();

	const RADIUS = 52;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	// A small gap between segments so neighbours read as separate arcs.
	const GAP = 3;

	const percent = (n: number) => (present === 0 ? 0 : Math.round((n / present) * 100));
	const completePercent = $derived(percent(complete));
	const segments = $derived(donutSegments({ complete, partial, none }, CIRCUMFERENCE, GAP));

	const labels = $derived(coverageFilterLabels(multiDay));
	const centreLabel = $derived(coverageStatusLabels(multiDay).complete);
	const legend = $derived<{ id: CoverageStatus; label: string; count: number }[]>([
		{ id: 'complete', label: labels.complete, count: complete },
		{ id: 'partial', label: labels.partial, count: partial },
		{ id: 'none', label: labels.none, count: none }
	]);
</script>

<Card.Root class="h-full gap-4 rounded-xl border-slate-200/80 bg-white py-4 shadow-2xs sm:py-5">
	<Card.Header class="px-4 sm:px-5">
		<Card.Title class="flex items-center gap-2 text-base font-semibold text-slate-900">
			<Gauge class="size-4 text-primary" aria-hidden="true" />
			ภาพรวมการรับอาหาร
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-1 flex-col items-center justify-center gap-5 px-4 sm:px-5">
		<div
			class="relative size-36 shrink-0"
			role="img"
			aria-label="{centreLabel} {completePercent}% ({complete} จาก {present} คน)"
		>
			<!-- Starts at 12 o'clock: the svg is turned a quarter back. -->
			<svg viewBox="0 0 120 120" class="size-full -rotate-90" aria-hidden="true">
				<circle cx="60" cy="60" r={RADIUS} fill="none" stroke-width="12" class="stroke-slate-100" />
				{#each segments as seg (seg.status)}
					<circle
						data-status={seg.status}
						cx="60"
						cy="60"
						r={RADIUS}
						fill="none"
						stroke-width="12"
						stroke={COVERAGE_STATUS_TONES[seg.status].color}
						stroke-dasharray="{seg.length} {CIRCUMFERENCE - seg.length}"
						stroke-dashoffset={-seg.start}
					/>
				{/each}
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
				<span class="text-2xl font-bold text-slate-900">{completePercent}%</span>
				<span class="text-xs text-slate-500">{complete} / {present} คน</span>
				<span class="text-xs text-slate-500">{centreLabel}</span>
			</div>
		</div>
		{#if present === 0}
			<p class="text-center text-sm text-slate-500">ไม่มีผู้ที่อยู่ในศูนย์ในช่วงนี้</p>
		{/if}
		<ul class="w-full space-y-1.5 text-sm">
			{#each legend as item (item.id)}
				<li class="flex items-center gap-2" data-status={item.id}>
					<span
						data-dot
						class="size-2.5 shrink-0 rounded-full"
						style="background-color: {COVERAGE_STATUS_TONES[item.id].color}"
						aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1 text-slate-600">{item.label}</span>
					<span class="font-semibold text-slate-900 tabular-nums">
						{item.count} คน {percent(item.count)}%
					</span>
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
