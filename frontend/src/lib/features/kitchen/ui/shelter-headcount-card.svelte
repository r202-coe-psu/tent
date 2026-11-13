<script lang="ts">
	import type { Component } from 'svelte';
	import Users from '@lucide/svelte/icons/users';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Baby from '@lucide/svelte/icons/baby';
	import Soup from '@lucide/svelte/icons/soup';
	import type { MealSessionHeadcount } from '../domain/kitchen';
	import type { ShelterPeopleCounts } from '../domain/occupancy';

	interface Props {
		/** `undefined` while the headcount query is loading. */
		people: ShelterPeopleCounts | undefined;
		headcount: MealSessionHeadcount | undefined;
	}

	let { people, headcount }: Props = $props();

	/** `undefined` = still loading; `null` = this group has no religion data to count from. */
	type Count = number | null | undefined;

	interface DetailRow {
		key: string;
		label: string;
		icon: Component;
		count: Count;
	}

	interface GroupCard {
		key: string;
		label: string;
		icon: Component;
		count: Count;
		detailsTitle: string;
		details: DetailRow[];
		emphasis?: boolean;
	}

	const HALAL_LABEL = 'อาหารฮาลาล';

	/** Same three special-diet groups, and labels, as the "สร้างมื้อใหม่" target form. */
	const dietRows = (prefix: string): DetailRow[] => [
		{ key: `${prefix}-halal`, label: HALAL_LABEL, icon: Utensils, count: headcount?.halal },
		{
			key: `${prefix}-soft_food`,
			label: 'อาหารอ่อน/ผู้สูงอายุ',
			icon: Soup,
			count: headcount?.soft_food
		},
		{ key: `${prefix}-infant`, label: 'ทารก/เด็กอ่อน', icon: Baby, count: headcount?.infant }
	];

	const groups = $derived<GroupCard[]>([
		{
			key: 'total',
			label: 'รวมทั้งหมด',
			icon: Users,
			count: headcount?.total,
			detailsTitle: 'อาหารพิเศษรวม',
			emphasis: true,
			details: dietRows('total')
		},
		{
			key: 'evacuees',
			label: 'ผู้อพยพ (ผู้พักพิง)',
			icon: ShieldCheck,
			count: people?.evacuees,
			detailsTitle: 'อาหารพิเศษ (ผู้พักพิง)',
			details: dietRows('evacuees')
		},
		{
			key: 'staff',
			label: 'เจ้าหน้าที่',
			icon: UserCheck,
			count: people?.staff,
			detailsTitle: 'อาหารพิเศษ (เจ้าหน้าที่)',
			details: [{ key: 'staff-halal', label: HALAL_LABEL, icon: Utensils, count: null }]
		},
		{
			key: 'volunteers',
			label: 'อาสาสมัคร',
			icon: HeartHandshake,
			count: people?.volunteers,
			detailsTitle: 'อาหารพิเศษ (อาสาสมัคร)',
			details: [{ key: 'volunteers-halal', label: HALAL_LABEL, icon: Utensils, count: null }]
		}
	]);

	const format = (count: Count) =>
		count === undefined ? '–' : count === null ? 'ไม่มีข้อมูล' : count;
</script>

<div class="space-y-2" data-testid="kitchen-headcount-card">
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each groups as group (group.key)}
			{@const Icon = group.icon}
			<section
				class="flex flex-col gap-4 rounded-xl border bg-white p-4 shadow-2xs sm:p-5 {group.emphasis
					? 'border-domain-registration-border'
					: 'border-slate-200/80'}"
				data-testid="kitchen-headcount-{group.key}"
			>
				<div class="flex items-start justify-between gap-2">
					<h2 class="text-base font-semibold text-slate-800">{group.label}</h2>
					<span class="rounded-lg border border-slate-200/80 bg-slate-50 p-2 text-slate-600">
						<Icon class="size-4" aria-hidden="true" />
					</span>
				</div>
				<div class="text-3xl font-bold text-slate-900 tabular-nums">
					<span data-testid="kitchen-headcount-{group.key}-value">{format(group.count)}</span>
					<span class="text-sm font-medium text-slate-500">คน</span>
				</div>
				<div class="mt-auto space-y-2 border-t border-slate-200/80 pt-3">
					<div class="flex justify-between gap-2 text-xs font-semibold text-slate-500">
						<span>{group.detailsTitle}</span>
						<span>จำนวน</span>
					</div>
					{#each group.details as row (row.key)}
						{@const RowIcon = row.icon}
						<div
							class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-sm"
						>
							<span class="flex items-center gap-2 whitespace-nowrap text-slate-700">
								<RowIcon class="size-4 shrink-0 text-slate-500" aria-hidden="true" />
								{row.label}
							</span>
							<span
								class="font-semibold whitespace-nowrap tabular-nums {row.count === null
									? 'text-slate-500'
									: 'text-slate-900'}"
							>
								<span data-testid="kitchen-headcount-{row.key}-value">{format(row.count)}</span>
								{#if row.count !== null}คน{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
	<p class="text-xs text-slate-500">
		กลุ่มอาหารนับซ้อนกันได้ คนหนึ่งอยู่ได้หลายกลุ่ม ·
		เจ้าหน้าที่และอาสาสมัครยังไม่มีข้อมูลศาสนาในระบบ
	</p>
</div>
