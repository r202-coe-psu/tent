<script lang="ts">
	import type { Component } from 'svelte';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Truck from '@lucide/svelte/icons/truck';
	import type { DaySummaryCard, LedgerGroup } from './ledger-view';

	let { cards, label }: { cards: DaySummaryCard[]; label: string } = $props();

	const TONE: Record<LedgerGroup, { number: string; icon: string; Icon: Component }> = {
		in: { number: 'text-emerald-800', icon: 'text-emerald-600', Icon: ArrowDownToLine },
		out: { number: 'text-orange-800', icon: 'text-orange-600', Icon: ArrowUpFromLine },
		adjust: { number: 'text-blue-800', icon: 'text-blue-600', Icon: SlidersHorizontal },
		transfer: { number: 'text-violet-800', icon: 'text-violet-600', Icon: Truck }
	};
</script>

<section aria-label={label} class="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:gap-3">
	{#each cards as card (card.group)}
		{@const tone = TONE[card.group]}
		<div
			class="flex min-h-[72px] flex-col justify-center gap-0.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs xl:min-h-28 xl:gap-1 xl:px-4 xl:py-3.5"
		>
			<span class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">{card.label}</span>
				<tone.Icon class="h-4 w-4 shrink-0 {tone.icon}" aria-hidden="true" />
			</span>
			<span class="text-2xl font-bold tabular-nums xl:text-3xl {tone.number}">{card.count}</span>
			<span class="hidden text-xs text-slate-500 xl:block">{card.hint}</span>
		</div>
	{/each}
</section>
