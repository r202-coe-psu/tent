<script lang="ts">
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import { BarChart } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { formatThaiDate } from '$lib/utils/date';
	import type { DailyMealTrend } from '../../domain/food-supplies/meal-coverage';

	interface Props {
		/** One entry per day of the range, oldest first. */
		trend: readonly DailyMealTrend[];
	}

	let { trend }: Props = $props();

	type Metric = 'portions' | 'people';
	let metric = $state<Metric>('portions');

	const METRICS: { id: Metric; label: string }[] = [
		{ id: 'portions', label: 'ชุดอาหารต่อมื้อ' },
		{ id: 'people', label: 'ผู้พักพิงที่มีบันทึก' }
	];

	const chartConfig = {
		breakfast: { label: 'เช้า', color: '#F59E0B' },
		lunch: { label: 'กลางวัน', color: '#0284C7' },
		dinner: { label: 'เย็น', color: '#6366F1' },
		people: { label: 'ผู้พักพิงที่มีบันทึก', color: '#16A34A' }
	} satisfies Chart.ChartConfig;

	const chartData = $derived(
		trend.map((d) => ({
			date: formatThaiDate(d.day),
			...d.portions,
			people: d.people
		}))
	);
	const series = $derived(
		(metric === 'portions'
			? (['breakfast', 'lunch', 'dinner'] as const)
			: (['people'] as const)
		).map((key) => ({ key, value: key, color: chartConfig[key].color }))
	);
	const isEmpty = $derived(
		trend.every((d) => d.people === 0 && Object.values(d.portions).every((n) => n === 0))
	);
	const unit = $derived(metric === 'portions' ? 'ชุด' : 'คน');
	// The x-axis is a band scale with one tick per bar: thin the labels so at most ~10 show.
	const xAxisTickStep = $derived(Math.max(1, Math.ceil(trend.length / 10)));
</script>

<Card.Root class="gap-4 rounded-xl border-slate-200/80 bg-white py-4 shadow-2xs sm:py-5">
	<Card.Header class="px-4 sm:px-5">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0 space-y-1">
				<Card.Title class="flex items-center gap-2 text-base font-semibold text-slate-900">
					<ChartColumn class="size-4 text-primary" aria-hidden="true" />
					แนวโน้มรายวัน
				</Card.Title>
				<Card.Description class="text-sm text-slate-500">
					{metric === 'portions'
						? 'ชุดอาหารที่แจกในแต่ละวัน แยกตามมื้อ (ทุกประเภทผู้รับ)'
						: 'จำนวนผู้พักพิงที่มีบันทึกรับอาหารอย่างน้อย 1 มื้อในแต่ละวัน'}
				</Card.Description>
			</div>
			<div class="flex gap-1.5" role="group" aria-label="ตัวชี้วัดของกราฟแนวโน้ม">
				{#each METRICS as m (m.id)}
					<button
						type="button"
						aria-pressed={metric === m.id}
						onclick={() => (metric = m.id)}
						class="min-h-9 cursor-pointer rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {metric ===
						m.id
							? 'border-slate-500 bg-slate-50 text-slate-900'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						{m.label}
					</button>
				{/each}
			</div>
		</div>
	</Card.Header>
	<Card.Content class="space-y-3 px-4 sm:px-5">
		{#if isEmpty}
			<div
				class="flex h-56 w-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500"
			>
				ไม่มีการแจกจ่ายในช่วงนี้
			</div>
		{:else}
			<div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-slate-600">
				{#each series as s (s.key)}
					<span class="flex items-center gap-1.5">
						<span class="size-3 rounded-full" style="background-color: {s.color}"></span>
						{chartConfig[s.key].label}
					</span>
				{/each}
			</div>
			<div aria-hidden="true">
				<Chart.Container config={chartConfig} class="h-64 w-full">
					<BarChart
						data={chartData}
						x="date"
						{series}
						seriesLayout="stack"
						xScale={scaleBand().paddingInner(0.2).paddingOuter(0.1)}
						padding={{ left: 32, bottom: 28 }}
						props={{
							bars: { radius: 2, strokeWidth: 0 },
							xAxis: {
								ticks: xAxisTickStep,
								tickLabelProps: { class: 'text-2xs fill-muted-foreground', dy: 10 }
							},
							yAxis: {
								format: (d: number) => (Number.isInteger(d) ? d.toString() : ''),
								tickLabelProps: { class: 'text-xs fill-muted-foreground', dx: -10 }
							},
							grid: { x: false, y: true, class: 'stroke-border stroke-1 stroke-dasharray-4' }
						}}
					>
						{#snippet tooltip()}
							<Chart.Tooltip>
								{#snippet formatter({ value, name, item })}
									<div
										class="h-2.5 w-2.5 shrink-0 rounded-[2px]"
										style="background-color: {chartConfig[item.key as keyof typeof chartConfig]
											?.color}"
									></div>
									<div class="flex flex-1 items-center justify-between gap-4 leading-none">
										<span class="text-muted-foreground">
											{chartConfig[item.key as keyof typeof chartConfig]?.label ?? name}
										</span>
										<span class="font-medium text-foreground tabular-nums">{value} {unit}</span>
									</div>
								{/snippet}
							</Chart.Tooltip>
						{/snippet}
					</BarChart>
				</Chart.Container>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
