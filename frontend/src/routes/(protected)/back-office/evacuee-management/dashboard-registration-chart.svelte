<script lang="ts">
	import { SvelteMap, SvelteDate } from 'svelte/reactivity';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { BarChart } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import type { RegistrationsPayload } from '$lib/features/dashboard';
	import {
		daysBetween,
		buildDateRange,
		getISOWeekMonday,
		formatThaiDate,
		formatThaiWeekRange
	} from '$lib/utils/date';

	let { data }: { data: RegistrationsPayload } = $props();

	const chartConfig = {
		checkin: { label: 'จำนวนคนลงทะเบียนเข้า', color: '#003B71' },
		checkout: { label: 'จำนวนคนลงทะเบียนออก', color: '#93C5FD' }
	} satisfies Chart.ChartConfig;

	const dayCount = $derived(daysBetween(data.range.from, data.range.to));
	const mode = $derived(dayCount > 60 ? 'weekly' : 'daily');

	function aggregateWeekly(dailyData: { date: string; checkin: number; checkout: number }[]) {
		const weeks = new SvelteMap<string, { checkin: number; checkout: number; endDate: string }>();
		for (const row of dailyData) {
			const mon = getISOWeekMonday(row.date);
			if (!weeks.has(mon)) {
				const d = new SvelteDate(mon);
				d.setUTCDate(d.getUTCDate() + 6);
				weeks.set(mon, { checkin: 0, checkout: 0, endDate: d.toISOString().slice(0, 10) });
			}
			const w = weeks.get(mon)!;
			w.checkin += row.checkin;
			w.checkout += row.checkout;
		}
		return Array.from(weeks.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([mon, w]) => ({
				date: formatThaiWeekRange(mon, w.endDate),
				checkin: w.checkin,
				checkout: w.checkout
			}));
	}

	const chartData = $derived.by(() => {
		const days = buildDateRange(data.range.from, data.range.to);
		const daily = days.map((date) => ({
			date,
			checkin: data.checkin[date] ?? 0,
			checkout: data.checkout[date] ?? 0
		}));
		if (mode === 'weekly') {
			return aggregateWeekly(daily);
		} else {
			return daily.map((row) => ({
				...row,
				date: formatThaiDate(row.date)
			}));
		}
	});

	// For LayerChart grouping
	const seriesKeys = ['checkin', 'checkout'];

	// The x-axis is a category (band) scale, so LayerChart renders one tick per
	// bar with no automatic thinning — over a long daily range that's 30-60+
	// overlapping date labels. Skip every Nth label so at most ~10 show at once.
	const xAxisTickStep = $derived(Math.max(1, Math.ceil(chartData.length / 10)));
</script>

<div class="h-full w-full">
	<div class="mb-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
		{#each Object.entries(chartConfig) as [key, config] (key)}
			<div class="flex items-center gap-1.5">
				<div class="h-3 w-3 rounded-full" style="background-color: {config.color}"></div>
				<span class="text-muted-foreground">{config.label}</span>
			</div>
		{/each}
	</div>
	<Chart.Container config={chartConfig} class="h-108 w-full">
		<BarChart
			data={chartData}
			x="date"
			y={seriesKeys}
			series={[
				{ key: 'checkin', value: 'checkin', color: chartConfig.checkin.color },
				{ key: 'checkout', value: 'checkout', color: chartConfig.checkout.color }
			]}
			seriesLayout="group"
			xScale={scaleBand().paddingInner(0.2).paddingOuter(0.1)}
			padding={{ left: 32, bottom: 28 }}
			props={{
				bars: {
					radius: 4,
					strokeWidth: 0
				},
				xAxis: {
					ticks: xAxisTickStep,
					tickLabelProps: {
						class: 'text-2xs fill-muted-foreground',
						dy: 10
					}
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
							style="background-color: {chartConfig[item.key as keyof typeof chartConfig]?.color}"
						></div>
						<div class="flex flex-1 items-center justify-between gap-4 leading-none">
							<span class="text-muted-foreground">
								{chartConfig[item.key as keyof typeof chartConfig]?.label ?? name}
							</span>
							<span class="font-mono font-medium text-foreground tabular-nums">
								{value} คน
							</span>
						</div>
					{/snippet}
				</Chart.Tooltip>
			{/snippet}
		</BarChart>
	</Chart.Container>
</div>
