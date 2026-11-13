<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import { hasPartialStatus } from '../../domain/food-supplies/meal-coverage';
	import type { CoverageFilter } from '../model/meal-coverage-view';

	interface Props {
		filter: CoverageFilter;
		/** `counts.all` is everyone present: the denominator of every share. */
		counts: Record<CoverageFilter, number>;
		/** Records a person needs; with 1 there is no "one meal" group, so that tile is left out. */
		threshold: number;
		/** Today counts people present since the start of the day, not all day. */
		isToday: boolean;
		onSelect: (filter: CoverageFilter) => void;
	}

	let { filter, counts, threshold, isToday, onSelect }: Props = $props();

	type Tile = {
		id: CoverageFilter;
		label: string;
		hint: string;
		icon: typeof Users;
		border: string;
		active: string;
		iconClass: string;
		bar: string;
	};

	const share = (n: number) => (counts.all === 0 ? 0 : (n / counts.all) * 100);
	const percent = (n: number) => `${Math.round(share(n))}%`;

	const tiles = $derived<Tile[]>([
		{
			id: 'all',
			label: isToday ? 'อยู่ในศูนย์ตั้งแต่ต้นวัน' : 'อยู่ในศูนย์ตลอดวัน',
			hint: `ยังไม่ครบ ${counts.all - counts.complete} คน`,
			icon: Users,
			border: 'border-slate-200/80',
			active: 'border-slate-500 bg-slate-50',
			iconClass: 'text-slate-500',
			bar: ''
		},
		{
			id: 'complete',
			label: 'ได้รับครบ',
			hint: `${percent(counts.complete)} ของผู้อยู่ในศูนย์`,
			icon: CircleCheck,
			border: 'border-emerald-200',
			active: 'border-emerald-500 bg-emerald-50',
			iconClass: 'text-emerald-600',
			bar: 'bg-emerald-500'
		},
		...(hasPartialStatus(threshold)
			? [
					{
						id: 'partial' as const,
						label: 'มีบันทึก 1 มื้อ',
						hint: `${percent(counts.partial)} ของผู้อยู่ในศูนย์`,
						icon: TriangleAlert,
						border: 'border-amber-200',
						active: 'border-amber-500 bg-amber-50',
						iconClass: 'text-amber-600',
						bar: 'bg-amber-500'
					}
				]
			: []),
		{
			id: 'none',
			label: 'ยังไม่มีบันทึกเลย',
			hint: `${percent(counts.none)} ของผู้อยู่ในศูนย์`,
			icon: CircleAlert,
			border: 'border-red-200',
			active: 'border-red-500 bg-red-50',
			iconClass: 'text-red-600',
			bar: 'bg-red-500'
		}
	]);
</script>

<div
	class="grid gap-3 sm:gap-4 {tiles.length === 4
		? 'grid-cols-2 lg:grid-cols-4'
		: 'grid-cols-1 sm:grid-cols-3'}"
>
	{#each tiles as tile (tile.id)}
		{@const isActive = filter === tile.id}
		<button
			type="button"
			aria-pressed={isActive}
			onclick={() => onSelect(tile.id)}
			class="min-h-11 cursor-pointer rounded-xl border p-4 text-left shadow-2xs transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {isActive
				? `${tile.active} ring-1 ring-slate-300`
				: `${tile.border} bg-white`}"
		>
			<span class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">{tile.label}</span>
				<tile.icon class="size-5 shrink-0 {tile.iconClass}" aria-hidden="true" />
			</span>
			<span class="mt-2 block text-3xl font-bold text-slate-900 tabular-nums">
				{counts[tile.id]}
			</span>
			<span class="mt-0.5 block text-sm text-slate-500 tabular-nums">{tile.hint}</span>
		</button>
	{/each}
</div>
