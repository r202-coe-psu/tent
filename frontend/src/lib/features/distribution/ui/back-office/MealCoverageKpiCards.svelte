<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import { MIN_MEALS_PER_DAY } from '../../domain/food-supplies/meal-coverage';
	import type { CoverageFilter } from '../model/meal-coverage-view';

	interface Props {
		filter: CoverageFilter;
		/** `counts.all` is everyone judged: the denominator of every share. */
		counts: Record<CoverageFilter, number>;
		/** People judged on no day, only there part of a day: not in the base of any card. */
		partDayOnly: number;
		/** The report covers several days: the breakdown words speak of days, not of one day's meals. */
		multiDay: boolean;
		onSelect: (filter: CoverageFilter) => void;
	}

	let { filter, counts, partDayOnly, multiDay, onSelect }: Props = $props();

	const percent = (n: number) => `${counts.all === 0 ? 0 : Math.round((n / counts.all) * 100)}%`;

	const focusRing =
		'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none';
	const cardBase = 'rounded-xl border p-4 shadow-2xs transition-colors';
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
	<button
		type="button"
		aria-pressed={filter === 'all'}
		onclick={() => onSelect('all')}
		class="min-h-11 cursor-pointer text-left hover:bg-slate-50 {cardBase} {focusRing} {filter ===
		'all'
			? 'border-slate-500 bg-slate-50 ring-1 ring-slate-300'
			: 'border-slate-200/80 bg-white'}"
	>
		<span class="flex items-center justify-between gap-2">
			<span class="text-sm font-semibold text-slate-700">ผู้พักพิงในศูนย์</span>
			<Users class="size-5 shrink-0 text-slate-500" aria-hidden="true" />
		</span>
		<span class="mt-2 block text-3xl font-bold text-slate-900 tabular-nums">{counts.all}</span>
		<span class="mt-0.5 block text-sm text-slate-500">
			{`นับเฉพาะผู้ที่อยู่ในศูนย์ทั้งวัน${partDayOnly > 0 ? ` · ไม่รวมผู้อยู่ไม่เต็มวัน ${partDayOnly} คน` : ''}`}
		</span>
	</button>

	<button
		type="button"
		aria-pressed={filter === 'complete'}
		onclick={() => onSelect('complete')}
		class="min-h-11 cursor-pointer text-left hover:bg-slate-50 {cardBase} {focusRing} {filter ===
		'complete'
			? 'border-emerald-500 bg-emerald-50 ring-1 ring-slate-300'
			: 'border-emerald-200 bg-white'}"
	>
		<span class="flex items-center justify-between gap-2">
			<span class="text-sm font-semibold text-slate-700">
				{`รับครบเกณฑ์ (${MIN_MEALS_PER_DAY} มื้อ/วัน)`}
			</span>
			<CircleCheck class="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
		</span>
		<span class="mt-2 block text-3xl font-bold text-slate-900 tabular-nums">
			{counts.complete}
		</span>
		<span class="mt-0.5 block text-sm text-slate-500 tabular-nums">
			{percent(counts.complete)} ของผู้พักพิงในศูนย์
		</span>
	</button>

	<!-- Not one big button: the two parts of the breakdown are buttons of their own. -->
	<div
		class="{cardBase} {filter === 'incomplete'
			? 'border-amber-500 bg-amber-50 ring-1 ring-slate-300'
			: 'border-amber-200 bg-white'}"
	>
		<button
			type="button"
			aria-pressed={filter === 'incomplete'}
			onclick={() => onSelect('incomplete')}
			class="min-h-11 w-full cursor-pointer rounded-lg text-left {focusRing}"
		>
			<span class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">รับไม่ครบเกณฑ์</span>
				<TriangleAlert class="size-5 shrink-0 text-amber-600" aria-hidden="true" />
			</span>
			<span class="mt-2 block text-3xl font-bold text-slate-900 tabular-nums">
				{counts.incomplete}
			</span>
			<span class="mt-0.5 block text-sm text-slate-500 tabular-nums">
				{percent(counts.incomplete)} ของผู้พักพิงในศูนย์
			</span>
		</button>
		<p
			class="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-amber-100 pt-2 text-sm tabular-nums"
		>
			<button
				type="button"
				aria-pressed={filter === 'partial'}
				onclick={() => onSelect('partial')}
				class="cursor-pointer rounded-sm underline decoration-amber-300 underline-offset-4 hover:decoration-slate-900 {focusRing} {filter ===
				'partial'
					? 'font-semibold text-slate-900'
					: 'text-slate-600'}"
			>
				{multiDay ? 'มีบันทึกบ้าง' : 'รับแล้ว 1 มื้อ'}
				{counts.partial} คน
			</button>
			<span class="text-slate-300" aria-hidden="true">·</span>
			<button
				type="button"
				aria-pressed={filter === 'none'}
				onclick={() => onSelect('none')}
				class="cursor-pointer rounded-sm underline decoration-red-300 underline-offset-4 hover:decoration-slate-900 {focusRing} {filter ===
				'none'
					? 'font-semibold text-slate-900'
					: 'text-slate-600'}"
			>
				{multiDay ? 'ไม่มีบันทึกรับเลย' : 'ยังไม่มีบันทึกรับ'}
				{counts.none} คน
			</button>
		</p>
	</div>
</div>
