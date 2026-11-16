<script lang="ts">
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		coverageLevel,
		type CoverageLevel,
		type ZoneCoverage
	} from '../model/meal-coverage-view';

	interface Props {
		zones: readonly ZoneCoverage[];
		zoneName: (code: string | null) => string;
	}

	let { zones, zoneName }: Props = $props();

	const BAR: Record<CoverageLevel, string> = {
		good: 'bg-emerald-500',
		fair: 'bg-amber-500',
		poor: 'bg-red-500'
	};
	const BADGE: Record<CoverageLevel, string> = {
		good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		fair: 'border-amber-200 bg-amber-50 text-amber-900',
		poor: 'border-red-200 bg-red-50 text-red-900'
	};
</script>

<Card.Root class="h-full gap-4 rounded-xl border-slate-200/80 bg-white py-4 shadow-2xs sm:py-5">
	<Card.Header class="px-4 sm:px-5">
		<Card.Title class="flex items-center gap-2 text-base font-semibold text-slate-900">
			<LayoutGrid class="size-4 text-primary" aria-hidden="true" />
			ความครบรายโซน
		</Card.Title>
		<Card.Description class="text-sm text-slate-500">
			ได้รับครบเทียบผู้ที่อยู่ในโซน เรียงโซนที่ครบน้อยสุดก่อน
		</Card.Description>
	</Card.Header>
	<Card.Content class="px-4 sm:px-5">
		<ul class="space-y-3">
			{#each zones as z (z.zone ?? '')}
				{@const level = coverageLevel(z.percent)}
				<li class="space-y-1">
					<div class="flex items-center justify-between gap-2 text-sm">
						<span class="min-w-0 truncate font-medium text-slate-900">
							{zoneName(z.zone) || 'ไม่ระบุโซน'}
						</span>
						<span class="flex shrink-0 items-center gap-2 tabular-nums">
							<span class="text-slate-500">
								<strong class="font-bold text-slate-900">{z.complete}</strong> / {z.total} คน
							</span>
							<span
								class="inline-flex items-center rounded-full border px-1.5 text-xs font-semibold {BADGE[
									level
								]}"
							>
								{z.percent}%
							</span>
						</span>
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
						<div class="h-full rounded-full {BAR[level]}" style="width: {z.percent}%"></div>
					</div>
				</li>
			{/each}
		</ul>
	</Card.Content>
</Card.Root>
