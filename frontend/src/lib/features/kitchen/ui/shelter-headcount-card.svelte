<script lang="ts">
	import type { Component } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import Users from '@lucide/svelte/icons/users';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Soup from '@lucide/svelte/icons/soup';
	import Baby from '@lucide/svelte/icons/baby';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { MealSessionHeadcount } from '../domain/kitchen';
	import type { ShelterPeopleCounts } from '../domain/occupancy';

	interface Props {
		/** `undefined` while the headcount query is loading. */
		people: ShelterPeopleCounts | undefined;
		headcount: MealSessionHeadcount | undefined;
	}

	let { people, headcount }: Props = $props();

	interface CountTile {
		key: string;
		label: string;
		icon: Component;
		count: number | undefined;
	}

	const groups = $derived<(CountTile & { emphasis?: boolean })[]>([
		{ key: 'total', label: 'รวมทั้งหมด', icon: Users, count: headcount?.total, emphasis: true },
		{ key: 'evacuees', label: 'ผู้พักพิง', icon: ShieldCheck, count: people?.evacuees },
		{ key: 'staff', label: 'เจ้าหน้าที่', icon: UserCheck, count: people?.staff },
		{ key: 'volunteers', label: 'อาสาสมัคร', icon: HeartHandshake, count: people?.volunteers }
	]);

	/** Same three special-diet groups, and labels, as the "สร้างมื้อใหม่" target form. */
	const diets = $derived<CountTile[]>([
		{ key: 'halal', label: 'อาหารฮาลาล', icon: Utensils, count: headcount?.halal },
		{ key: 'soft_food', label: 'อาหารอ่อน/ผู้สูงอายุ', icon: Soup, count: headcount?.soft_food },
		{ key: 'infant', label: 'ทารก/เด็กอ่อน', icon: Baby, count: headcount?.infant }
	]);

	let dietsOpen = $state(true);
</script>

<div class="space-y-3" data-testid="kitchen-headcount-card">
	<div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
		{#each groups as group (group.key)}
			{@const Icon = group.icon}
			<section
				class="rounded-xl border bg-white p-4 shadow-2xs {group.emphasis
					? 'border-domain-registration-border'
					: 'border-slate-200/80'}"
				data-testid="kitchen-headcount-{group.key}"
			>
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-sm font-semibold text-slate-700">{group.label}</h2>
					<Icon class="size-4 text-slate-400" aria-hidden="true" />
				</div>
				<div class="mt-1 text-3xl font-bold text-slate-900 tabular-nums">
					<span data-testid="kitchen-headcount-{group.key}-value">{group.count ?? '–'}</span>
					<span class="text-sm font-medium text-slate-500">คน</span>
				</div>
			</section>
		{/each}
	</div>

	<section class="rounded-xl border border-slate-200/80 bg-white p-2 shadow-2xs">
		<Button
			variant="ghost"
			class="h-auto min-h-11 w-full justify-between gap-2 px-2 py-2 text-left aria-expanded:bg-transparent"
			aria-expanded={dietsOpen}
			aria-controls="kitchen-headcount-diets"
			onclick={() => (dietsOpen = !dietsOpen)}
		>
			<span class="text-sm font-semibold text-slate-700">อาหารพิเศษ (เฉพาะผู้พักพิง)</span>
			<ChevronDown
				class="size-4 text-slate-500 transition-transform {dietsOpen ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>
		</Button>
		{#if dietsOpen}
			<div id="kitchen-headcount-diets" class="space-y-2 px-2 pt-1 pb-2">
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
					{#each diets as diet (diet.key)}
						{@const Icon = diet.icon}
						<div
							class="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2"
						>
							<span class="flex items-center gap-2 text-sm text-slate-700">
								<Icon class="size-4 text-slate-400" aria-hidden="true" />
								{diet.label}
							</span>
							<span class="text-lg font-bold whitespace-nowrap text-slate-900 tabular-nums">
								<span data-testid="kitchen-headcount-{diet.key}-value">{diet.count ?? '–'}</span>
								<span class="text-sm font-medium text-slate-500">คน</span>
							</span>
						</div>
					{/each}
				</div>
				<p class="text-xs text-slate-500">
					นับซ้อนกันได้ คนหนึ่งอยู่ได้หลายกลุ่ม · เจ้าหน้าที่และอาสาสมัครยังไม่มีข้อมูลศาสนาในระบบ
				</p>
			</div>
		{/if}
	</section>
</div>
