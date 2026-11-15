<script lang="ts">
	import type { Component } from 'svelte';
	import { BarChart } from 'layerchart';
	import { scaleBand } from 'd3-scale';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { getMealPeriodLabel } from '../model/ticket-status';

	export interface RatioRow {
		meal: MealPeriod;
		done: number;
		/** `null` when no denominator is known for this meal. */
		total: number | null;
		/** The meal is not over yet on a running day. */
		pending: boolean;
	}

	interface Props {
		title: string;
		description: string;
		unit: 'ชุด' | 'คน';
		/** Legend and tooltip name of the muted bar (the denominator). */
		totalLabel: string;
		/** Legend and tooltip name of the accent bar. */
		doneLabel: string;
		icon: Component<{ class?: string; 'aria-hidden'?: 'true' }>;
		/** Hex of the accent bar. */
		accent: string;
		rows: readonly RatioRow[];
		/** A last footer cell, e.g. people with enough meals on record. */
		summary?: { label: string; done: number; total: number };
	}

	let {
		title,
		description,
		unit,
		totalLabel,
		doneLabel,
		icon: Icon,
		accent,
		rows,
		summary
	}: Props = $props();

	const uid = $props.id();
	const titleId = `ratio-card-${uid}`;

	const MUTED = '#CBD5E1';

	const chartConfig = $derived({
		total: { label: totalLabel, color: MUTED },
		done: { label: doneLabel, color: accent }
	} satisfies Chart.ChartConfig);

	const chartData = $derived(
		rows.map((r) => ({ meal: getMealPeriodLabel(r.meal), total: r.total ?? 0, done: r.done }))
	);

	const percent = (done: number, total: number | null) =>
		total === null || total <= 0 ? null : Math.round((done / total) * 100);

	const cells = $derived([
		...rows.map((r) => ({
			id: r.meal as string,
			label: getMealPeriodLabel(r.meal),
			done: r.done,
			total: r.total,
			pending: r.pending
		})),
		...(summary
			? [
					{
						id: 'summary',
						label: summary.label,
						done: summary.done,
						total: summary.total,
						pending: false
					}
				]
			: [])
	]);
</script>

<Card.Root
	class="h-full gap-4 rounded-xl border-slate-200/80 bg-white py-4 shadow-2xs sm:py-5"
	role="group"
	aria-labelledby={titleId}
>
	<Card.Header class="px-4 sm:px-5">
		<div class="flex items-start gap-3">
			<span
				class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 ring-1 ring-slate-200"
				style="color: {accent}"
			>
				<Icon class="size-5" aria-hidden="true" />
			</span>
			<div class="min-w-0 space-y-1">
				<Card.Title id={titleId} class="text-base font-semibold text-slate-900">{title}</Card.Title>
				<Card.Description class="text-sm text-slate-500">{description}</Card.Description>
			</div>
		</div>
	</Card.Header>
	<Card.Content class="flex flex-1 flex-col gap-3 px-4 sm:px-5">
		<div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-slate-600">
			<span class="flex items-center gap-1.5">
				<span class="size-3 rounded-full" style="background-color: {MUTED}"></span>{totalLabel}
			</span>
			<span class="flex items-center gap-1.5">
				<span class="size-3 rounded-full" style="background-color: {accent}"></span>{doneLabel}
			</span>
		</div>
		<div aria-hidden="true">
			<Chart.Container config={chartConfig} class="h-56 w-full">
				<BarChart
					data={chartData}
					x="meal"
					y={['total', 'done']}
					series={[
						{ key: 'total', value: 'total', color: MUTED },
						{ key: 'done', value: 'done', color: accent }
					]}
					seriesLayout="group"
					xScale={scaleBand().paddingInner(0.2).paddingOuter(0.1)}
					padding={{ left: 32, bottom: 28 }}
					props={{
						bars: { radius: 4, strokeWidth: 0 },
						xAxis: { tickLabelProps: { class: 'text-xs fill-muted-foreground', dy: 10 } },
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
		<dl
			class="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-(--cols)"
			style="--cols: repeat({cells.length}, minmax(0, 1fr))"
		>
			{#each cells as cell (cell.id)}
				{@const pct = percent(cell.done, cell.total)}
				<div class="min-w-0 space-y-0.5 text-sm">
					<dt class="font-semibold text-slate-700">{cell.label}</dt>
					{#if cell.pending}
						<dd class="text-slate-500">
							ยังไม่ถึงมื้อ{cell.done > 0 ? ` · มีบันทึก ${cell.done} ${unit}` : ''}
						</dd>
					{:else if cell.total === null}
						<dd class="text-slate-600 tabular-nums">
							<span class="font-semibold text-slate-900">{cell.done}</span>
							{unit}
						</dd>
						<dd class="text-xs text-slate-500">ไม่มีบันทึกผลผลิตครัว</dd>
					{:else}
						<dd class="text-slate-600 tabular-nums">
							<span class="font-semibold text-slate-900">{cell.done}</span>/{cell.total}
							{unit}
						</dd>
						{#if pct !== null}
							<dd class="font-semibold text-slate-900 tabular-nums">{pct}%</dd>
						{/if}
					{/if}
				</div>
			{/each}
		</dl>
	</Card.Content>
</Card.Root>
