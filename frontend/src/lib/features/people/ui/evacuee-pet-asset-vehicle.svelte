<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { buildDisclaimerGroups } from '../domain/disclaimer';
	import type { Household, HouseholdVehicle, PetGroup } from '../domain/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_PET_ASSET_VEHICLE_I18N } from './_constants/evacuee-pet-asset-vehicle.i18n';

	let {
		household = null,
		pending = false,
		onBack,
		onNext
	}: {
		household?: Household | null;
		pending?: boolean;
		onBack: () => void;
		onNext: (data: {
			pets: PetGroup[];
			assetDescription: string;
			vehicles: HouseholdVehicle[];
		}) => void;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_PET_ASSET_VEHICLE_I18N, languageStore.current));

	type PetRow = {
		id: number;
		species: 'dog' | 'cat' | 'bird' | 'other';
		count: number;
		notes: string;
		has_cage: boolean;
	};
	let nextPetId = 0;

	let assetDescription = $state(untrack(() => household?.assets?.description ?? ''));
	let petRows = $state<PetRow[]>(
		untrack(() =>
			(household?.pets ?? []).map((p) => ({
				id: nextPetId++,
				species: p.species,
				count: p.count,
				notes: p.notes ?? '',
				has_cage: p.has_cage ?? false
			}))
		)
	);

	const petSpeciesOptions = $derived([
		{ value: 'dog', label: t.pets.options.dog },
		{ value: 'cat', label: t.pets.options.cat },
		{ value: 'bird', label: t.pets.options.bird },
		{ value: 'other', label: t.pets.options.other }
	] as const);

	function addPet() {
		petRows = [
			...petRows,
			{ id: nextPetId++, species: 'dog', count: 1, notes: '', has_cage: false }
		];
	}

	function removePet(id: number) {
		petRows = petRows.filter((p) => p.id !== id);
	}

	type VehicleRow = { id: number; type: 'car' | 'motorcycle' | 'other'; license_plate: string };
	let nextVehicleId = 0;
	let vehicleRows = $state<VehicleRow[]>(
		untrack(() =>
			(household?.vehicles ?? []).map((v) => ({
				id: nextVehicleId++,
				type: v.type,
				license_plate: v.license_plate ?? ''
			}))
		)
	);

	const vehicleTypeOptions = $derived([
		{ value: 'car', label: t.vehicles.options.car },
		{ value: 'motorcycle', label: t.vehicles.options.motorcycle },
		{ value: 'other', label: t.vehicles.options.other }
	] as const);

	function addVehicle() {
		vehicleRows = [...vehicleRows, { id: nextVehicleId++, type: 'car', license_plate: '' }];
	}

	function removeVehicle(id: number) {
		vehicleRows = vehicleRows.filter((v) => v.id !== id);
	}

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelter = $derived(shelterQuery.data);

	const disclaimerGroups = $derived(
		buildDisclaimerGroups({
			assetDescription,
			petCount: petRows.length,
			vehicleCount: vehicleRows.length,
			shelter
		})
	);

	let disclaimerAcknowledged = $state(false);
	const disclaimerRequired = $derived(disclaimerGroups.length > 0);
</script>

<div class="space-y-6">
	<!-- Pets Section — a household may bring several -->
	<section class="space-y-3">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<h3 class="text-sm font-semibold">{t.pets.title}</h3>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="h-10 w-full shrink-0 bg-background sm:h-8 sm:w-auto"
				onclick={addPet}
			>
				<Plus class="mr-1 h-3.5 w-3.5" />
				{t.pets.btnAdd}
			</Button>
		</div>

		{#if petRows.length === 0}
			<p class="text-xs text-muted-foreground">
				{t.pets.empty}
			</p>
		{:else}
			<div class="space-y-2">
				{#each petRows as pet (pet.id)}
					<div
						class="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-end"
					>
						<div class="w-full space-y-1 sm:w-[110px] sm:shrink-0">
							<Label class="text-[10px] text-muted-foreground">{t.pets.speciesLabel}</Label>
							<Select.Root type="single" bind:value={pet.species}>
								<Select.Trigger class="h-11 w-full bg-background text-sm sm:h-9">
									{petSpeciesOptions.find((o) => o.value === pet.species)?.label ??
										t.pets.speciesLabel}
								</Select.Trigger>
								<Select.Content>
									{#each petSpeciesOptions as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="w-full space-y-1 sm:w-[72px] sm:shrink-0">
							<Label class="text-[10px] text-muted-foreground">{t.pets.countLabel}</Label>
							<Input
								type="number"
								min={1}
								class="h-11 bg-background text-sm sm:h-9"
								bind:value={pet.count}
							/>
						</div>
						<div class="flex-1 space-y-1">
							<Label class="text-[10px] text-muted-foreground">{t.pets.notesLabel}</Label>
							<Input
								class="h-11 bg-background text-sm sm:h-9"
								bind:value={pet.notes}
								placeholder={t.pets.notesPlaceholder}
							/>
						</div>
						<div class="flex items-center justify-between gap-2">
							<div
								class="flex h-11 flex-1 items-center gap-1.5 rounded-md border bg-background px-3 sm:h-9 sm:flex-none"
							>
								<Checkbox
									id="pet_cage_{pet.id}"
									checked={pet.has_cage}
									onCheckedChange={(v) => (pet.has_cage = !!v)}
								/>
								<label for="pet_cage_{pet.id}" class="cursor-pointer text-xs whitespace-nowrap">
									{t.pets.cageLabel}
								</label>
							</div>
							<Button
								type="button"
								variant="outline"
								size="icon"
								class="h-11 w-11 shrink-0 bg-background sm:h-9 sm:w-9"
								onclick={() => removePet(pet.id)}
							>
								<X class="h-4 w-4 text-muted-foreground" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Assets Section -->
	<section class="space-y-3">
		<h3 class="text-sm font-semibold">{t.assets.title}</h3>
		<Input
			bind:value={assetDescription}
			placeholder={t.assets.placeholder}
			class="h-12 bg-background sm:h-10"
		/>
	</section>

	<!-- Vehicles Section -->
	<section class="space-y-3">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<h3 class="text-sm font-semibold">{t.vehicles.title}</h3>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="h-10 w-full shrink-0 bg-background sm:h-8 sm:w-auto"
				onclick={addVehicle}
			>
				<Plus class="mr-1 h-3.5 w-3.5" />
				{t.vehicles.btnAdd}
			</Button>
		</div>

		{#if vehicleRows.length === 0}
			<p class="text-xs text-muted-foreground">{t.vehicles.empty}</p>
		{:else}
			<div class="space-y-2">
				{#each vehicleRows as vehicle (vehicle.id)}
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Select.Root type="single" bind:value={vehicle.type}>
							<Select.Trigger class="h-12 w-full bg-background sm:h-10 sm:w-[120px] sm:shrink-0">
								{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ??
									t.vehicles.typeLabel}
							</Select.Trigger>
							<Select.Content>
								{#each vehicleTypeOptions as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<div class="flex items-center gap-2">
							<Input
								bind:value={vehicle.license_plate}
								placeholder={t.vehicles.platePlaceholder}
								class="h-12 flex-1 bg-background sm:h-10"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								class="h-12 w-12 shrink-0 bg-background sm:h-10 sm:w-10"
								onclick={() => removeVehicle(vehicle.id)}
							>
								<X class="h-4 w-4 text-muted-foreground" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if disclaimerRequired}
		<section class="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
			<div class="flex items-center gap-2">
				<ShieldAlert class="h-5 w-5 text-amber-600" />
				<h3 class="text-sm font-bold text-amber-800">
					{t.disclaimer.title}
				</h3>
			</div>
			<div class="space-y-3">
				{#each disclaimerGroups as group (group.label)}
					<div>
						<h4 class="mb-1 text-sm font-semibold text-amber-800">{group.label}</h4>
						<ul class="list-disc space-y-1 pl-6 text-sm text-amber-900">
							{#each group.items as item, i (i)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
			<label
				class="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-amber-300/90 bg-white/90 p-3.5 shadow-xs transition-all hover:border-amber-400 hover:bg-white dark:border-amber-700/60 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
			>
				<Checkbox
					id="disclaimer-ack"
					checked={disclaimerAcknowledged}
					onCheckedChange={(v) => (disclaimerAcknowledged = v === true)}
					class="mt-0.5 size-5 shrink-0 rounded-md border-2 border-slate-400 bg-white shadow-xs data-[state=checked]:border-slate-600 data-[state=checked]:bg-slate-600 data-[state=checked]:text-white dark:border-slate-500 dark:bg-slate-900 dark:data-[state=checked]:border-slate-400 dark:data-[state=checked]:bg-slate-500"
				/>
				<span
					class="text-sm leading-relaxed font-semibold text-amber-950 select-none dark:text-amber-100"
				>
					{t.disclaimer.acknowledge}
				</span>
			</label>
		</section>
	{/if}

	<div
		class="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
	>
		<Button
			type="button"
			disabled={pending || (disclaimerRequired && !disclaimerAcknowledged)}
			class="h-12 w-full bg-[#003B71] text-base font-medium hover:bg-[#002a50] sm:w-auto sm:px-8"
			onclick={() =>
				onNext({
					pets: petRows.map((p) => ({
						species: p.species,
						count: Number(p.count) || 1,
						notes: p.notes.trim() || undefined,
						has_cage: p.has_cage
					})),
					assetDescription,
					vehicles: vehicleRows.map((v) => ({
						type: v.type,
						license_plate: v.license_plate.trim() || null
					}))
				})}
		>
			{t.actions.next}
		</Button>
		<Button
			type="button"
			variant="outline"
			class="h-12 w-full text-base font-medium sm:w-auto sm:px-8"
			onclick={onBack}
		>
			{t.actions.back}
		</Button>
	</div>
</div>
