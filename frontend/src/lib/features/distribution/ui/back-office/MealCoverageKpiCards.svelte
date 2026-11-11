<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import { hasPartialStatus } from '../../domain/food-supplies/meal-coverage';
	import type { CoverageFilter } from '../model/meal-coverage-view';

	interface Props {
		filter: CoverageFilter;
		presentCount: number;
		counts: Record<CoverageFilter, number>;
		/** Records a person needs; with 1 there is no "one meal" group, so that card is left out. */
		threshold: number;
		/** Today counts people present since the start of the day, not all day. */
		isToday: boolean;
		onSelect: (filter: CoverageFilter) => void;
	}

	let { filter, presentCount, counts, threshold, isToday, onSelect }: Props = $props();

	type Card = {
		id: CoverageFilter;
		label: string;
		value: number;
		hint: string;
		icon: typeof Users;
		border: string;
		active: string;
		iconClass: string;
	};
	const cards = $derived<Card[]>([
		{
			id: 'all',
			label: isToday ? 'อยู่ในศูนย์ตั้งแต่ต้นวัน' : 'อยู่ในศูนย์ตลอดวัน',
			value: presentCount,
			hint: `ยังไม่ครบ ${counts.all} คน`,
			icon: Users,
			border: 'border-slate-200/80',
			active: 'border-slate-500 bg-slate-50',
			iconClass: 'text-slate-500'
		},
		{
			id: 'none',
			label: 'ยังไม่มีบันทึกเลย',
			value: counts.none,
			hint: 'ยังไม่มีบันทึกรับอาหารสักมื้อ',
			icon: CircleAlert,
			border: 'border-red-200',
			active: 'border-red-500 bg-red-50',
			iconClass: 'text-red-600'
		},
		...(hasPartialStatus(threshold)
			? [
					{
						id: 'partial' as const,
						label: 'มีบันทึก 1 มื้อ',
						value: counts.partial,
						hint: `ยังไม่ถึง ${threshold} มื้อ`,
						icon: TriangleAlert,
						border: 'border-amber-200',
						active: 'border-amber-500 bg-amber-50',
						iconClass: 'text-amber-600'
					}
				]
			: [])
	]);
</script>

<div
	class="grid grid-cols-1 gap-4 sm:grid-cols-(--cols)"
	style="--cols: repeat({cards.length}, minmax(0, 1fr))"
>
	{#each cards as card (card.id)}
		{@const isActive = filter === card.id}
		<button
			type="button"
			aria-pressed={isActive}
			onclick={() => onSelect(card.id)}
			class="min-h-11 cursor-pointer rounded-xl border p-4 text-left shadow-2xs transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {isActive
				? `${card.active} ring-1 ring-slate-300`
				: `${card.border} bg-white`}"
		>
			<span class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">{card.label}</span>
				<card.icon class="size-5 {card.iconClass}" aria-hidden="true" />
			</span>
			<span class="mt-2 block text-3xl font-bold text-slate-900 tabular-nums">{card.value}</span>
			<span class="mt-0.5 block text-sm text-slate-500">{card.hint}</span>
		</button>
	{/each}
</div>
