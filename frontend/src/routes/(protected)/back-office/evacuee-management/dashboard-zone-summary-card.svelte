<script lang="ts">
	import Gauge from '@lucide/svelte/icons/gauge';
	import type { ZoneOccupancyLevel, ZoneOccupancySummary } from '$lib/features/dashboard';

	let { summary }: { summary: ZoneOccupancySummary } = $props();

	const RADIUS = 52;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	const filled = $derived(CIRCUMFERENCE * (Math.min(100, summary.percent) / 100));

	const RING: Record<ZoneOccupancyLevel, string> = {
		normal: 'stroke-emerald-500',
		warning: 'stroke-amber-500',
		full: 'stroke-red-500'
	};

	const LEGEND = [
		{ key: 'normal', label: 'ปกติ', dot: 'bg-emerald-500' },
		{ key: 'warning', label: 'ใกล้เต็ม', dot: 'bg-amber-500' },
		{ key: 'full', label: 'เต็ม', dot: 'bg-red-500' },
		{ key: 'closed', label: 'ปิด', dot: 'border border-slate-400 bg-slate-100' }
	] as const;
</script>

<div class="flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-sm sm:p-6">
	<div class="mb-4 flex items-center gap-2">
		<Gauge class="h-4 w-4 text-primary" />
		<h3 class="leading-none font-semibold tracking-tight">ภาพรวมความจุ</h3>
	</div>

	<div class="flex flex-1 flex-col items-center justify-center gap-6 sm:flex-row sm:justify-around">
		<div
			class="relative h-36 w-36 shrink-0"
			role="img"
			aria-label="ใช้ความจุไป {summary.percent}% ({summary.present.toLocaleString()} จาก {summary.capacity.toLocaleString()} คน)"
		>
			<svg viewBox="0 0 120 120" class="h-full w-full -rotate-90" aria-hidden="true">
				<circle cx="60" cy="60" r={RADIUS} fill="none" stroke-width="12" class="stroke-slate-100" />
				<circle
					cx="60"
					cy="60"
					r={RADIUS}
					fill="none"
					stroke-width="12"
					stroke-linecap="round"
					stroke-dasharray="{filled} {CIRCUMFERENCE}"
					class="{RING[summary.level]} transition-all duration-300"
				/>
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
				<span class="text-2xl font-bold text-foreground">{summary.percent}%</span>
				<span class="text-xs text-muted-foreground">
					{summary.present.toLocaleString()} / {summary.capacity.toLocaleString()} คน
				</span>
			</div>
		</div>

		<div class="space-y-3">
			<p class="text-sm text-muted-foreground">
				ว่างอีก
				<strong class="text-lg font-bold text-foreground tabular-nums">
					{summary.available.toLocaleString()}
				</strong>
				ที่
			</p>
			<ul class="space-y-1.5 text-sm">
				{#each LEGEND as item (item.key)}
					<li class="flex items-center gap-2">
						<span class="h-2.5 w-2.5 shrink-0 rounded-full {item.dot}"></span>
						<span class="w-16 text-muted-foreground">{item.label}</span>
						<span class="font-semibold text-foreground tabular-nums">
							{summary.zones[item.key]} โซน
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</div>
