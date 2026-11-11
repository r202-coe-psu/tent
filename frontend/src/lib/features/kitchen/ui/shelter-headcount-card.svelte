<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import type { MealSessionHeadcount } from '../domain/kitchen';
	import type { ShelterPeopleCounts } from '../domain/occupancy';

	interface Props {
		/** `undefined` while the headcount query is loading. */
		people: ShelterPeopleCounts | undefined;
		headcount: MealSessionHeadcount | undefined;
	}

	let { people, headcount }: Props = $props();

	interface CountRow {
		key: string;
		label: string;
		count: number | undefined;
		emphasis?: boolean;
	}

	const peopleRows = $derived<CountRow[]>([
		{ key: 'total', label: 'รวมทั้งหมด', count: headcount?.total, emphasis: true },
		{ key: 'evacuees', label: 'ผู้อพยพ', count: people?.evacuees },
		{ key: 'staff', label: 'เจ้าหน้าที่', count: people?.staff },
		{ key: 'volunteers', label: 'อาสาสมัคร', count: people?.volunteers }
	]);

	const dietaryRows = $derived<CountRow[]>([
		{ key: 'halal', label: 'ฮาลาล (มุสลิม)', count: headcount?.halal },
		{ key: 'infant', label: 'เด็กเล็ก', count: headcount?.infant },
		{ key: 'soft_food', label: 'อาหารอ่อน', count: headcount?.soft_food }
	]);
</script>

{#snippet countTile(row: CountRow)}
	<div
		class="min-w-28 flex-1 rounded-xl border bg-white p-3 shadow-2xs {row.emphasis
			? 'border-slate-300'
			: 'border-slate-200/80'}"
		data-testid="kitchen-headcount-{row.key}"
	>
		<div class="text-sm font-medium text-slate-700">{row.label}</div>
		<div class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
			<span data-testid="kitchen-headcount-{row.key}-value">{row.count ?? '–'}</span>
			<span class="text-sm font-medium text-muted-foreground">คน</span>
		</div>
	</div>
{/snippet}

<Card.Root
	class="gap-0 border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
	data-testid="kitchen-headcount-card"
>
	<div class="grid gap-5 lg:grid-cols-2">
		<section class="space-y-3">
			<h2 class="text-base font-semibold text-slate-800">จำนวนคนในศูนย์พักพิง</h2>
			<div class="flex flex-wrap gap-2.5">
				{#each peopleRows as row (row.key)}
					{@render countTile(row)}
				{/each}
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-base font-semibold text-slate-800">กลุ่มอาหารพิเศษ (เฉพาะผู้อพยพ)</h2>
			<div class="flex flex-wrap gap-2.5">
				{#each dietaryRows as row (row.key)}
					{@render countTile(row)}
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				นับซ้อนกันได้ คนหนึ่งอยู่ได้หลายกลุ่ม และกลุ่มฮาลาลนับเฉพาะผู้อพยพ
			</p>
		</section>
	</div>
</Card.Root>
