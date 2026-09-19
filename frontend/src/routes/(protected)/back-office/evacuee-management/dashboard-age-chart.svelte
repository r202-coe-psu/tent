<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { BarChart } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import { AGE_BUCKETS, AGE_BUCKET_LABELS, type AgeGroups } from '$lib/features/dashboard';

	let { data }: { data: AgeGroups } = $props();

	const ageChartConfig = {
		count: { label: 'จำนวน (คน)', color: 'var(--primary)' }
	} satisfies Chart.ChartConfig;

	const ageData = $derived(
		AGE_BUCKETS.map((bucket) => ({
			bucket: AGE_BUCKET_LABELS[bucket],
			count: data[bucket] ?? 0
		}))
	);
</script>

<Chart.Container config={ageChartConfig} class="min-h-[260px] w-full">
	<BarChart
		data={ageData}
		x="count"
		y="bucket"
		orientation="horizontal"
		padding={{ left: 150, bottom: 24 }}
		yScale={scaleBand().paddingInner(0.2).paddingOuter(0.1)}
		props={{
			bars: {
				radius: 4,
				fill: 'var(--color-primary)'
			},
			xAxis: {
				tickLabelProps: { class: 'text-xs fill-muted-foreground', dy: 10 }
			},
			yAxis: {
				tickLabelProps: { class: 'text-2xs fill-muted-foreground', dx: -10 }
			},
			grid: { x: true, y: false, class: 'stroke-border stroke-1 stroke-dasharray-4' }
		}}
	>
		{#snippet tooltip()}
			<Chart.Tooltip
				labelFormatter={(value) => (value === AGE_BUCKET_LABELS.unknown ? 'อายุ ไม่ระบุ' : value)}
			>
				{#snippet formatter({ value })}
					<div
						class="h-2.5 w-2.5 shrink-0 rounded-[2px]"
						style="background-color: hsl(var(--primary))"
					></div>
					<div class="flex flex-1 items-center justify-between gap-4 leading-none">
						<span class="text-muted-foreground">จำนวน </span>
						<span class="font-mono font-medium text-foreground tabular-nums">
							{value} คน
						</span>
					</div>
				{/snippet}
			</Chart.Tooltip>
		{/snippet}
	</BarChart>
</Chart.Container>
