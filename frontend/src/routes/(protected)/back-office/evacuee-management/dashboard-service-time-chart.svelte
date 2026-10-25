<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { BarChart } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import { formatServiceDuration } from '$lib/features/dashboard';

	/** One bar: a station or a channel, with its mean service time (null = nothing timed yet). */
	type ServiceTimeBar = { label: string; seconds: number | null };

	let { items, heightClass = 'h-56' }: { items: ServiceTimeBar[]; heightClass?: string } = $props();

	const chartConfig = {
		minutes: { label: 'เวลาให้บริการเฉลี่ย', color: 'var(--primary)' }
	} satisfies Chart.ChartConfig;

	// Plotted in minutes (unrounded, so the tooltip can show the exact mean).
	const chartData = $derived(
		items.map((item) => ({ label: item.label, minutes: (item.seconds ?? 0) / 60 }))
	);
</script>

<Chart.Container config={chartConfig} class="w-full {heightClass}">
	<BarChart
		data={chartData}
		x="label"
		y="minutes"
		xScale={scaleBand().paddingInner(0.3).paddingOuter(0.2)}
		padding={{ left: 40, bottom: 28 }}
		props={{
			bars: { radius: 4, fill: 'var(--color-primary)' },
			xAxis: { tickLabelProps: { class: 'text-xs fill-muted-foreground', dy: 10 } },
			yAxis: {
				format: (d: number) => `${Number.isInteger(d) ? d : d.toFixed(1)} น.`,
				tickLabelProps: { class: 'text-xs fill-muted-foreground', dx: -6 }
			},
			grid: { x: false, y: true, class: 'stroke-border stroke-1 stroke-dasharray-4' }
		}}
	>
		{#snippet tooltip()}
			<Chart.Tooltip>
				{#snippet formatter({ value })}
					<div class="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-primary"></div>
					<div class="flex flex-1 items-center justify-between gap-4 leading-none">
						<span class="text-muted-foreground">{chartConfig.minutes.label}</span>
						<span class="font-mono font-medium text-foreground tabular-nums">
							{Number(value) > 0 ? formatServiceDuration(Number(value) * 60) : 'ยังไม่มีข้อมูล'}
						</span>
					</div>
				{/snippet}
			</Chart.Tooltip>
		{/snippet}
	</BarChart>
</Chart.Container>
