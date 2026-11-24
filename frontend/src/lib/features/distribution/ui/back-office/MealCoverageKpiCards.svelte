<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import { MIN_MEALS_PER_DAY } from '../../domain/food-supplies/meal-coverage';
	import {
		COVERAGE_STATUS_TONES,
		coverageStatusLabels,
		type CoverageFilter,
		type CoverageStatus
	} from '../model/meal-coverage-view';

	interface Props {
		/** `counts.all` is everyone judged: the denominator of every share. */
		counts: Record<CoverageFilter, number>;
		/** People judged on no day, only there part of a day: not in the base of any card. */
		partDayOnly: number;
		/** The report covers several days: the titles word the one-meal status for a range. */
		multiDay: boolean;
	}

	let { counts, partDayOnly, multiDay }: Props = $props();

	const percent = (n: number) => `${counts.all === 0 ? 0 : Math.round((n / counts.all) * 100)}%`;
	const labels = $derived(coverageStatusLabels(multiDay));

	type Card = {
		id: 'all' | CoverageStatus;
		label: string;
		hint: string;
		/** A muted second line. */
		note?: string;
		icon: typeof Users;
		/** Accent colour of the icon: the same token as the donut segment and legend dot. */
		color: string;
		border: string;
	};

	// Short on purpose: each subtitle fits one line at lg.
	const share = (n: number) => `${percent(n)} ของผู้พักพิง`;
	const cards = $derived<Card[]>([
		{
			id: 'all',
			label: multiDay ? 'ผู้พักพิงในช่วงนี้' : 'ผู้พักพิงในศูนย์',
			hint: multiDay ? 'อยู่ในศูนย์ทั้งวันอย่างน้อย 1 วัน' : 'อยู่ในศูนย์ทั้งวัน',
			note: partDayOnly > 0 ? `ไม่รวมผู้อยู่ไม่เต็มวัน ${partDayOnly} คน` : undefined,
			icon: Users,
			color: '#64748B',
			border: 'border-slate-200/80'
		},
		{
			id: 'complete',
			label: labels.complete,
			hint: share(counts.complete),
			icon: CircleCheck,
			color: COVERAGE_STATUS_TONES.complete.color,
			border: COVERAGE_STATUS_TONES.complete.border
		},
		{
			id: 'partial',
			label: labels.partial,
			hint: multiDay
				? `มีวันที่รับ 0–1 มื้อ · ${percent(counts.partial)}`
				: `ขาดอีก 1 มื้อ · ${percent(counts.partial)}`,
			icon: TriangleAlert,
			color: COVERAGE_STATUS_TONES.partial.color,
			border: COVERAGE_STATUS_TONES.partial.border
		},
		{
			id: 'none',
			label: labels.none,
			hint: multiDay
				? share(counts.none)
				: `ขาด ${MIN_MEALS_PER_DAY} มื้อ · ${percent(counts.none)}`,
			icon: CircleAlert,
			color: COVERAGE_STATUS_TONES.none.color,
			border: COVERAGE_STATUS_TONES.none.border
		}
	]);
</script>

<!-- Informational only: the table's own filter bar is the one way to filter. -->
<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
	{#each cards as card (card.id)}
		<article
			data-card={card.id}
			class="min-h-11 rounded-xl border bg-white p-4 text-left shadow-2xs {card.border}"
		>
			<div class="flex items-center justify-between gap-2">
				<h5 class="text-sm font-semibold text-slate-700">{card.label}</h5>
				<card.icon class="size-5 shrink-0" style="color: {card.color}" aria-hidden="true" />
			</div>
			<p class="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{counts[card.id]}</p>
			<p class="mt-0.5 text-sm text-slate-500 tabular-nums">{card.hint}</p>
			{#if card.note}
				<p class="text-xs text-slate-400">{card.note}</p>
			{/if}
		</article>
	{/each}
</div>
