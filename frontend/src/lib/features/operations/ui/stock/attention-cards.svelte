<script lang="ts">
	import type { Component } from 'svelte';
	import CalendarX from '@lucide/svelte/icons/calendar-x';
	import PackageX from '@lucide/svelte/icons/package-x';
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import { EXPIRING_SOON_DAYS } from '../../domain/stock-summary';
	import type { AttentionCounts, StockStatusFilter } from './stock-view';

	let {
		counts,
		selected,
		onselect
	}: {
		counts: AttentionCounts;
		selected: StockStatusFilter | 'all';
		/** Clicking the selected card again passes 'all' (clears the filter). */
		onselect: (status: StockStatusFilter | 'all') => void;
	} = $props();

	type CardDef = {
		key: StockStatusFilter;
		label: string;
		hint: string;
		tone: 'critical' | 'warning';
		icon: Component;
	};

	const CARDS: CardDef[] = [
		{
			key: 'expired',
			label: 'หมดอายุ',
			hint: 'ต้องคัดออก / เขียนทิ้ง',
			tone: 'critical',
			icon: CalendarX
		},
		{ key: 'empty', label: 'หมด', hint: 'ไม่มีของเหลือ', tone: 'critical', icon: PackageX },
		{
			key: 'low',
			label: 'ใกล้หมด',
			hint: 'ต่ำกว่าเกณฑ์สั่งเพิ่ม',
			tone: 'warning',
			icon: TrendingDown
		},
		{
			key: 'expiring',
			label: 'ใกล้หมดอายุ',
			hint: `ภายใน ${EXPIRING_SOON_DAYS} วัน`,
			tone: 'warning',
			icon: Hourglass
		}
	];

	const NUMBER_CLASS = { critical: 'text-red-700', warning: 'text-amber-700' };
	const ICON_CLASS = { critical: 'text-red-600', warning: 'text-amber-600' };
</script>

<section
	aria-label="สรุปสิ่งที่ต้องจัดการ"
	class="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:gap-3"
>
	{#each CARDS as card (card.key)}
		{@const isSelected = selected === card.key}
		<button
			type="button"
			aria-pressed={isSelected}
			onclick={() => onselect(isSelected ? 'all' : card.key)}
			class="flex min-h-[72px] flex-col items-start justify-center gap-0.5 rounded-xl px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none xl:min-h-28 xl:gap-1 xl:px-4 xl:py-3.5 {isSelected
				? 'border-2 border-[#0284C7] bg-sky-50'
				: 'border border-slate-200/80 bg-white shadow-2xs hover:border-slate-300'}"
		>
			<span class="flex w-full items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">{card.label}</span>
				<card.icon class="h-4 w-4 shrink-0 {ICON_CLASS[card.tone]}" aria-hidden="true" />
			</span>
			<span class="text-2xl font-bold tabular-nums xl:text-3xl {NUMBER_CLASS[card.tone]}">
				{counts[card.key]}
			</span>
			<span class="hidden text-xs text-slate-500 xl:block">{card.hint}</span>
		</button>
	{/each}
</section>
