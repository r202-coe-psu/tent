<script lang="ts">
	import {
		capSeries,
		formatDayLabel,
		MAX_TREND_ROWS,
		pickTickIndices,
		seriesMax,
		wasAggregated,
		type TrendSeries
	} from './trend-chart.aggregate';

	let {
		series,
		days = 7,
		maxRows = MAX_TREND_ROWS,
		title = 'แนวโน้มของขาดแคลน',
		unitLabel = 'หน่วย'
	}: {
		/** Per-category shortage series (one line each), ascending by date. */
		series: TrendSeries[];
		/** Window covered, for the subtitle copy. Default 7 days. */
		days?: number;
		/** Max rendered points per series; over this the series is aggregated. */
		maxRows?: number;
		title?: string;
		/** Unit shown in tooltips/legend, e.g. "หน่วย", "คน", "กก." */
		unitLabel?: string;
	} = $props();

	// SVG user-space (HTML labels are overlaid, so padding only guards the plot).
	const VIEW_W = 1000;
	const VIEW_H = 300;
	const PAD_X = 8;
	const INNER_TOP = 14;
	const INNER_BOTTOM = VIEW_H - 6;

	// Default palette maps to the theme's --chart-* tokens (food / supply / volunteer / …).
	const PALETTE = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-4)',
		'var(--chart-5)',
		'var(--chart-3)'
	];
	const Y_RATIOS = [0, 0.5, 1];

	const processed = $derived(
		capSeries(series, maxRows).map((s, i) => ({
			...s,
			color: s.color ?? PALETTE[i % PALETTE.length]
		}))
	);
	const aggregated = $derived(wasAggregated(series, maxRows));
	const yMax = $derived(seriesMax(processed));
	const count = $derived(processed.reduce((m, s) => Math.max(m, s.points.length), 0));
	const hasData = $derived(count > 0);
	const tickIndices = $derived(pickTickIndices(count, 7));
	const axisDates = $derived(
		processed.reduce<string[]>(
			(longest, s) => (s.points.length > longest.length ? s.points.map((p) => p.date) : longest),
			[]
		)
	);

	const numberFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
	const formatNum = (n: number) => numberFmt.format(n);

	function xAt(i: number): number {
		if (count <= 1) return VIEW_W / 2;
		return PAD_X + (i / (count - 1)) * (VIEW_W - 2 * PAD_X);
	}
	function yAt(gap: number): number {
		const clamped = Math.max(0, Math.min(gap, yMax));
		return INNER_BOTTOM - (clamped / yMax) * (INNER_BOTTOM - INNER_TOP);
	}
	const pct = (value: number, span: number) => (value / span) * 100;
</script>

<section
	class="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"
	role="img"
	aria-label="{title} ย้อนหลัง {days} วัน แยกตามหมวดทรัพยากร"
>
	<header class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex flex-col">
			<h3 class="text-sm font-semibold">{title}</h3>
			<p class="text-xs text-muted-foreground">ย้อนหลัง {days} วัน</p>
		</div>
		{#if hasData}
			<ul class="flex flex-wrap gap-x-3 gap-y-1">
				{#each processed as s (s.key)}
					{@const latest = s.points.at(-1)?.gap ?? 0}
					<li class="flex items-center gap-1.5 text-xs">
						<span class="h-2.5 w-2.5 rounded-full" style="background:{s.color}"></span>
						<span class="font-medium">{s.label}</span>
						<span class="text-muted-foreground tabular-nums">{formatNum(latest)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</header>

	{#if aggregated}
		<p class="text-xs text-warning-subtle">
			ข้อมูลเกิน {formatNum(maxRows)} แถว — แสดงแบบรวมช่วงเฉลี่ย
		</p>
	{/if}

	{#if !hasData}
		<p class="py-10 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลแนวโน้มในช่วงนี้</p>
	{:else}
		<div class="relative aspect-[10/3] w-full">
			<svg class="h-full w-full" viewBox="0 0 {VIEW_W} {VIEW_H}" role="presentation">
				<!-- horizontal gridlines -->
				{#each Y_RATIOS as ratio (ratio)}
					{@const y = yAt(ratio * yMax)}
					<line
						x1="0"
						x2={VIEW_W}
						y1={y}
						y2={y}
						stroke="var(--border)"
						stroke-width="1"
						vector-effect="non-scaling-stroke"
					/>
				{/each}

				{#each processed as s (s.key)}
					<polyline
						points={s.points.map((p, i) => `${xAt(i)},${yAt(p.gap)}`).join(' ')}
						fill="none"
						stroke={s.color}
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
						vector-effect="non-scaling-stroke"
					/>
					{#each tickIndices as i (i)}
						{@const p = s.points[i]}
						{#if p}
							<circle cx={xAt(i)} cy={yAt(p.gap)} r="5" fill={s.color}>
								<title>{s.label} · {formatDayLabel(p.date)}: {formatNum(p.gap)} {unitLabel}</title>
							</circle>
						{/if}
					{/each}
				{/each}
			</svg>

			<!-- y-axis value labels (HTML keeps text crisp regardless of width) -->
			{#each Y_RATIOS as ratio (ratio)}
				<span
					class="absolute left-0 -translate-y-1/2 rounded bg-card/80 px-1 text-[10px] text-muted-foreground tabular-nums"
					style="top:{pct(yAt(ratio * yMax), VIEW_H)}%"
				>
					{formatNum(ratio * yMax)}
				</span>
			{/each}
		</div>

		<!-- x-axis date labels -->
		<div class="relative h-4 w-full">
			{#each tickIndices as i (i)}
				{#if axisDates[i]}
					<span
						class="absolute -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums"
						style="left:{pct(xAt(i), VIEW_W)}%"
					>
						{formatDayLabel(axisDates[i])}
					</span>
				{/if}
			{/each}
		</div>
	{/if}
</section>
