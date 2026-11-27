<script lang="ts">
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import IdCard from '@lucide/svelte/icons/id-card';
	import UserRound from '@lucide/svelte/icons/user-round';
	import {
		COVERAGE_MEALS,
		type OtherRecipientGroup,
		type OtherRecipientsOfMeal
	} from '../../domain/food-supplies/meal-coverage';
	import { otherRecipientTotals } from '../model/meal-coverage-view';
	import { getMealPeriodLabel } from '../model/ticket-status';

	interface Props {
		meals: readonly OtherRecipientsOfMeal[];
	}

	let { meals }: Props = $props();

	const GROUPS: Record<
		OtherRecipientGroup,
		{ label: string; hint?: string; icon: typeof UserRound; border: string; iconClass: string }
	> = {
		outside: {
			label: 'บุคคลภายนอก',
			hint: 'ไม่ระบุตัวตน',
			icon: UserRound,
			border: 'border-sky-200',
			iconClass: 'text-sky-600'
		},
		volunteer: {
			label: 'จิตอาสา',
			icon: HeartHandshake,
			border: 'border-violet-200',
			iconClass: 'text-violet-600'
		},
		staff: {
			label: 'เจ้าหน้าที่',
			icon: IdCard,
			border: 'border-teal-200',
			iconClass: 'text-teal-600'
		}
	};

	const totals = $derived(otherRecipientTotals(meals));
	const MEALS = COVERAGE_MEALS;
</script>

<section class="space-y-3" aria-labelledby="meal-coverage-others-title">
	<div class="space-y-0.5">
		<h4 id="meal-coverage-others-title" class="text-base font-bold text-slate-900">
			ผู้รับที่ไม่อยู่ในรายชื่อผู้พักพิง
		</h4>
		<p class="text-sm text-slate-500">นับแยกจากรายชื่อผู้พักพิง แต่รวมอยู่ในจำนวนชุดที่แจก</p>
	</div>
	<ul class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
		{#each totals as t (t.group)}
			{@const g = GROUPS[t.group]}
			{@const muted = t.portions === 0}
			<li
				class="space-y-2 rounded-xl border bg-white p-4 shadow-2xs {muted
					? 'border-slate-200/80'
					: g.border}"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="text-sm font-semibold {muted ? 'text-slate-400' : 'text-slate-700'}">
							{g.label}
						</p>
						{#if g.hint}
							<p class="text-xs {muted ? 'text-slate-400' : 'text-slate-500'}">{g.hint}</p>
						{/if}
					</div>
					<g.icon
						class="size-5 shrink-0 {muted ? 'text-slate-300' : g.iconClass}"
						aria-hidden="true"
					/>
				</div>
				<p class="tabular-nums {muted ? 'text-slate-400' : 'text-slate-900'}">
					<span class="text-3xl font-bold">{t.portions}</span>
					<span class="text-sm font-normal"> ชุด</span>
				</p>
				<ul class="divide-y divide-slate-100 border-t border-slate-100 text-sm">
					{#each MEALS as meal (meal)}
						{@const portions = t.byMeal[meal]}
						{@const none = portions === 0}
						<li
							class="flex items-center justify-between gap-3 py-1.5 {none
								? 'text-slate-400'
								: 'text-slate-700'}"
						>
							<span>{getMealPeriodLabel(meal)}</span>
							<span class="text-right tabular-nums {none ? '' : 'font-semibold text-slate-900'}">
								{portions} ชุด
							</span>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
</section>
