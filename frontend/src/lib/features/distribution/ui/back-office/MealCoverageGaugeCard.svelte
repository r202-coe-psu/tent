<script lang="ts">
	import Gauge from '@lucide/svelte/icons/gauge';
	import * as Card from '$lib/components/ui/card/index.js';
	import { coverageLevel, type CoverageLevel } from '../model/meal-coverage-view';

	interface Props {
		present: number;
		complete: number;
		partial: number;
		none: number;
		/** Records a person needs; names the "complete" group. */
		threshold: number;
		showPartial: boolean;
	}

	let { present, complete, partial, none, threshold, showPartial }: Props = $props();

	const RADIUS = 52;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	const percent = (n: number) => (present === 0 ? 0 : Math.round((n / present) * 100));
	const completePercent = $derived(percent(complete));
	const level = $derived<CoverageLevel>(coverageLevel(completePercent));
	const filled = $derived(CIRCUMFERENCE * (completePercent / 100));
	const RING: Record<CoverageLevel, string> = {
		good: 'stroke-emerald-500',
		fair: 'stroke-amber-500',
		poor: 'stroke-red-500'
	};

	const legend = $derived([
		{
			id: 'complete',
			label: `ได้รับครบ ${threshold} มื้อ`,
			count: complete,
			dot: 'bg-emerald-500'
		},
		...(showPartial
			? [{ id: 'partial', label: 'มีบันทึก 1 มื้อ', count: partial, dot: 'bg-amber-500' }]
			: []),
		{ id: 'none', label: 'ยังไม่มีบันทึกเลย', count: none, dot: 'bg-red-500' }
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
			aria-label="ได้รับครบ {completePercent}% ({complete} จาก {present} คน)"
		>
			<svg viewBox="0 0 120 120" class="size-full -rotate-90" aria-hidden="true">
				<circle cx="60" cy="60" r={RADIUS} fill="none" stroke-width="12" class="stroke-slate-100" />
				<circle
					cx="60"
					cy="60"
					r={RADIUS}
					fill="none"
					stroke-width="12"
					stroke-linecap="round"
					stroke-dasharray="{filled} {CIRCUMFERENCE}"
					class="{RING[level]} transition-all duration-300"
				/>
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
				<span class="text-2xl font-bold text-slate-900">{completePercent}%</span>
				<span class="text-xs text-slate-500">{complete} / {present} คน</span>
			</div>
		</div>
		<ul class="w-full space-y-1.5 text-sm">
			{#each legend as item (item.id)}
				<li class="flex items-center gap-2">
					<span class="size-2.5 shrink-0 rounded-full {item.dot}" aria-hidden="true"></span>
					<span class="min-w-0 flex-1 text-slate-600">{item.label}</span>
					<span class="font-semibold text-slate-900 tabular-nums">
						{item.count} คน {percent(item.count)}%
					</span>
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
