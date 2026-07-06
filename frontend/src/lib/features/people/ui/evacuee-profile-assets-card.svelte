<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { Household } from '$lib/features/people';

	let {
		household,
		readonly,
		onOpenAssetModal
	}: {
		household: Household | null;
		readonly: boolean;
		onOpenAssetModal: () => void;
	} = $props();

	// A household may bring several vehicles (schema vehicles[], CR-016).
	const vehicles = $derived(household?.vehicles ?? []);

	const vehicleLabel = (type: 'car' | 'motorcycle' | 'other') =>
		type === 'car' ? 'รถยนต์' : type === 'motorcycle' ? 'จักรยานยนต์' : 'อื่นๆ';
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2.5">
			<Car class="size-4.5 text-primary" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
				ทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง
			</h3>
		</div>
		{#if household && !readonly}
			<button
				onclick={onOpenAssetModal}
				class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>

	<div class="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
		<!-- Vehicles -->
		<div class="flex flex-col justify-between space-y-1.5">
			<span class="text-xs font-semibold text-muted-foreground">ยานพาหนะ:</span>
			<div class="flex min-h-[70px] flex-1 flex-col justify-center gap-1.5">
				{#if vehicles.length > 0}
					{#each vehicles as vehicle, i (`${vehicle.type}-${vehicle.license_plate}-${i}`)}
						<div
							class="flex flex-col gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900"
						>
							<span class="text-xs font-bold text-slate-700 dark:text-slate-300">
								🚗 {vehicleLabel(vehicle.type)}
							</span>
							{#if vehicle.license_plate}
								<span class="text-xs font-bold text-slate-900 dark:text-slate-100">
									ทะเบียน: {vehicle.license_plate}
								</span>
							{/if}
						</div>
					{/each}
				{:else}
					<div
						class="flex flex-1 items-center rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
					>
						<span class="text-xs text-muted-foreground italic">ไม่มี</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Assets / Valuables -->
		<div class="flex flex-col justify-between space-y-1.5">
			<span class="text-xs font-semibold text-muted-foreground">สัมภาระ/สิ่งของมีค่า:</span>
			<div
				class="flex min-h-[70px] flex-1 items-center rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
			>
				{#if household?.assets?.description}
					<span class="text-xs font-medium text-slate-600 italic dark:text-slate-400">
						{household.assets.description}
					</span>
				{:else}
					<span class="text-xs text-muted-foreground italic">ไม่มี</span>
				{/if}
			</div>
		</div>

		<!-- Pets -->
		<div class="flex flex-col justify-between space-y-1.5">
			<span class="text-xs font-semibold text-muted-foreground">สัตว์เลี้ยง:</span>
			<div class="flex min-h-[70px] flex-1 flex-col justify-center gap-1.5">
				{#if household && household.pets && household.pets.length > 0}
					{#each household.pets as pet (pet.species)}
						{@const petEmoji =
							pet.species === 'dog'
								? '🐶'
								: pet.species === 'cat'
									? '🐱'
									: pet.species === 'bird'
										? '🐦'
										: '🐾'}
						{@const speciesLabel =
							pet.species === 'dog'
								? 'สุนัข'
								: pet.species === 'cat'
									? 'แมว'
									: pet.species === 'bird'
										? 'นก'
										: 'อื่นๆ'}
						<div
							class="flex flex-col gap-1 rounded-2xl border border-amber-100 bg-amber-50/50 p-2.5 dark:border-amber-900/30 dark:bg-amber-950/20"
						>
							<div
								class="flex items-center justify-between text-[11px] font-bold text-amber-800 dark:text-amber-400"
							>
								<span>{petEmoji} {speciesLabel}</span>
								<span class="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] dark:bg-amber-950">
									{pet.count} ตัว
								</span>
							</div>
							{#if pet.has_cage}
								<span
									class="mt-0.5 flex items-center gap-0.5 text-[9px] font-bold text-green-700 dark:text-green-400"
								>
									✓ มีกรง
								</span>
							{/if}
							{#if pet.notes}
								<span
									class="mt-0.5 flex items-center gap-0.5 text-[9px] font-bold text-slate-600 dark:text-slate-400"
								>
									{pet.notes}
								</span>
							{/if}
						</div>
					{/each}
				{:else}
					<div
						class="flex flex-1 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
					>
						<span class="text-xs text-muted-foreground italic">ไม่มี</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
