<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Car from '@lucide/svelte/icons/car';
	import Dog from '@lucide/svelte/icons/dog';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { groupPetsBySpecies, petSpeciesLabel, type Household } from '../../domain/people';

	let {
		household,
		onOpenAssetsModal
	}: {
		household: Household;
		onOpenAssetsModal: () => void;
	} = $props();

	const groupedPets = $derived(groupPetsBySpecies(household.pets ?? []));
	const vehicles = $derived(household.vehicles ?? []);
	const valuables = $derived(household.assets?.description?.trim() || null);
	const hasAny = $derived(vehicles.length > 0 || groupedPets.length > 0 || Boolean(valuables));
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-3">
		<h3 class="flex items-center gap-2 text-base font-black text-slate-800 dark:text-slate-200">
			<Sparkles class="size-5 text-primary" />
			ทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง
		</h3>
		<Button variant="outline" size="sm" onclick={onOpenAssetsModal}>
			<Pencil class="mr-1.5 size-3.5" /> แก้ไขข้อมูล
		</Button>
	</div>

	{#if !hasAny}
		<p class="py-6 text-center text-sm text-muted-foreground italic">ไม่มีรายการ</p>
	{:else}
		<div class="space-y-4">
			<!-- Vehicles -->
			{#if vehicles.length > 0}
				<div class="space-y-2">
					<h4 class="flex items-center gap-1.5 text-xs font-bold text-slate-700">
						<Car class="size-4 text-slate-500" />
						ข้อมูลยานพาหนะ
					</h4>
					<div class="flex flex-wrap gap-2">
						{#each vehicles as v, i (i)}
							<Badge variant="outline" class="px-2.5 py-1 text-xs">
								{{ car: '🚗 รถยนต์', motorcycle: '🏍️ รถจักรยานยนต์', other: '🚲 อื่นๆ' }[v.type]}
								{#if v.license_plate}· {v.license_plate}{/if}
							</Badge>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Pets -->
			{#if groupedPets.length > 0}
				<div class="space-y-2">
					<h4 class="flex items-center gap-1.5 text-xs font-bold text-slate-700">
						<Dog class="size-4 text-slate-500" />
						สัตว์เลี้ยงที่นำมาด้วย
					</h4>
					<div class="flex flex-wrap gap-2">
						{#each groupedPets as p (p.species)}
							<Badge variant="outline" class="px-2.5 py-1 text-xs">
								{petSpeciesLabel(p.species)}
								({p.count} ตัว)
								{#if p.hasCage}· มีกรง{/if}
							</Badge>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Valuables -->
			{#if valuables}
				<div class="space-y-1.5">
					<Label class="text-xs text-muted-foreground">สัมภาระและสิ่งของมีค่า</Label>
					<p class="text-sm text-slate-800">{valuables}</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
