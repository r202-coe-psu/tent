<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import Minus from '@lucide/svelte/icons/minus';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Car from '@lucide/svelte/icons/car';
	import Package from '@lucide/svelte/icons/package';
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

	type PetSpecies = 'dog' | 'cat' | 'bird' | 'other';
	type PetDetail = {
		id: number;
		species: PetSpecies;
		name: string;
		condition: string;
		has_cage: boolean;
	};

	const SPECIES: PetSpecies[] = ['dog', 'cat', 'bird', 'other'];
	let nextPetId = 0;

	function petDetailFromGroup(p: PetGroup): PetDetail {
		const parts = (p.notes ?? '').split('|').map((s) => s.trim());
		return {
			id: nextPetId++,
			species: p.species,
			name: parts[0] ?? '',
			condition: parts[1] ?? '',
			has_cage: p.has_cage ?? false
		};
	}

	const initialPets = untrack(() => household?.pets ?? []);
	let hasPets = $state(initialPets.length > 0);
	let petDetails = $state<PetDetail[]>(
		untrack(() => initialPets.flatMap((p) => Array.from({ length: p.count }, () => petDetailFromGroup(p))))
	);

	const speciesCounts = $derived(
		SPECIES.reduce(
			(acc, species) => {
				acc[species] = petDetails.filter((p) => p.species === species).length;
				return acc;
			},
			{} as Record<PetSpecies, number>
		)
	);

	const petSpeciesOptions = $derived(
		SPECIES.map((value) => ({
			value,
			label: t.pets.options[value]
		}))
	);

	function adjustSpeciesCount(species: PetSpecies, delta: number) {
		if (delta > 0) {
			petDetails = [
				...petDetails,
				{ id: nextPetId++, species, name: '', condition: '', has_cage: false }
			];
		} else if (delta < 0) {
			const idx = [...petDetails].reverse().findIndex((p) => p.species === species);
			if (idx === -1) return;
			const removeAt = petDetails.length - 1 - idx;
			petDetails = petDetails.filter((_, i) => i !== removeAt);
		}
		hasPets = petDetails.length > 0;
	}

	function removePet(id: number) {
		petDetails = petDetails.filter((p) => p.id !== id);
		hasPets = petDetails.length > 0;
	}

	let hasAssets = $state(Boolean(untrack(() => household?.assets?.description)));
	let assetDescription = $state(untrack(() => household?.assets?.description ?? ''));

	const initialVehicles = untrack(() => household?.vehicles ?? []);
	let hasVehicles = $state(initialVehicles.length > 0);
	type VehicleRow = { id: number; type: 'car' | 'motorcycle' | 'other'; license_plate: string };
	let nextVehicleId = 0;
	let vehicleRows = $state<VehicleRow[]>(
		untrack(() =>
			initialVehicles.map((v) => ({
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
		hasVehicles = true;
	}

	function removeVehicle(id: number) {
		vehicleRows = vehicleRows.filter((v) => v.id !== id);
		hasVehicles = vehicleRows.length > 0;
	}

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelter = $derived(shelterQuery.data);

	const disclaimerGroups = $derived(
		buildDisclaimerGroups({
			assetDescription: hasAssets ? assetDescription : '',
			petCount: hasPets ? petDetails.length : 0,
			vehicleCount: hasVehicles ? vehicleRows.length : 0,
			shelter
		})
	);

	let disclaimerAcknowledged = $state(false);
	const disclaimerRequired = $derived(disclaimerGroups.length > 0);

	const selectTriggerClass =
		'form-control-touch flex w-full items-center rounded-md border border-input bg-background px-3 font-medium shadow-xs';

	function buildPetGroups(): PetGroup[] {
		if (!hasPets) return [];
		return petDetails.map((p) => {
			const notes = [p.name.trim(), p.condition.trim()].filter(Boolean).join(' | ');
			return {
				species: p.species,
				count: 1,
				notes: notes || undefined,
				has_cage: p.has_cage
			};
		});
	}
</script>

<div class="space-y-6">
	<!-- Pets -->
	<section class="form-section-card space-y-4">
		<div class="flex items-center gap-2">
			<PawPrint class="size-5 text-primary" />
			<h3 class="text-base font-bold text-foreground">{t.pets.title}</h3>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {!hasPets
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				onclick={() => {
					hasPets = false;
					petDetails = [];
				}}
			>
				{t.pets.hasPetsNo}
			</button>
			<button
				type="button"
				class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {hasPets
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				onclick={() => {
					hasPets = true;
					if (petDetails.length === 0) {
						adjustSpeciesCount('dog', 1);
					}
				}}
			>
				{t.pets.hasPets}
			</button>
		</div>

		{#if hasPets}
			<div class="space-y-3 border-t border-border pt-4">
				<p class="text-sm font-medium text-muted-foreground">{t.pets.countLabel}</p>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each petSpeciesOptions as opt (opt.value)}
						{@const count = speciesCounts[opt.value]}
						<div
							class="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2"
						>
							<span class="text-sm font-medium">{opt.label}</span>
							<div class="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="icon"
									class="touch-target size-10 shrink-0"
									disabled={count === 0}
									onclick={() => adjustSpeciesCount(opt.value, -1)}
								>
									<Minus class="size-4" />
								</Button>
								<span class="min-w-6 text-center font-mono text-lg font-bold">{count}</span>
								<Button
									type="button"
									variant="outline"
									size="icon"
									class="touch-target size-10 shrink-0"
									onclick={() => adjustSpeciesCount(opt.value, 1)}
								>
									<Plus class="size-4" />
								</Button>
							</div>
						</div>
					{/each}
				</div>

				{#if petDetails.length > 0}
					<p class="pt-2 text-sm font-semibold text-foreground">{t.pets.detailsTitle}</p>
					<div class="space-y-3">
						{#each petDetails as pet, i (pet.id)}
							{@const speciesLabel = petSpeciesOptions.find((o) => o.value === pet.species)?.label}
							<div class="space-y-3 rounded-xl border border-border bg-background p-3">
								<div class="flex items-center justify-between gap-2">
									<span class="text-sm font-bold text-foreground">
										{speciesLabel} — {t.pets.petNumber(i + 1)}
									</span>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="touch-target size-10 shrink-0"
										onclick={() => removePet(pet.id)}
									>
										<X class="size-4 text-muted-foreground" />
									</Button>
								</div>
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div class="space-y-1.5">
										<Label class="text-sm">{t.pets.nameLabel}</Label>
										<Input
											class="form-control-touch bg-background"
											bind:value={pet.name}
											placeholder={t.pets.namePlaceholder}
										/>
									</div>
									<div class="space-y-1.5">
										<Label class="text-sm">{t.pets.conditionLabel}</Label>
										<Input
											class="form-control-touch bg-background"
											bind:value={pet.condition}
											placeholder={t.pets.conditionPlaceholder}
										/>
									</div>
								</div>
								<label
									class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 px-3"
								>
									<Checkbox
										checked={pet.has_cage}
										onCheckedChange={(v) => (pet.has_cage = !!v)}
										class="size-5"
									/>
									<span class="text-sm">{t.pets.cageLabel}</span>
								</label>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Assets -->
	<section class="form-section-card space-y-4">
		<div class="flex items-center gap-2">
			<Package class="size-5 text-primary" />
			<h3 class="text-base font-bold text-foreground">{t.assets.title}</h3>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {!hasAssets
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				onclick={() => {
					hasAssets = false;
					assetDescription = '';
				}}
			>
				{t.assets.hasAssetsNo}
			</button>
			<button
				type="button"
				class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {hasAssets
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				onclick={() => (hasAssets = true)}
			>
				{t.assets.hasAssets}
			</button>
		</div>
		{#if hasAssets}
			<div class="space-y-1.5">
				<Label class="text-sm">{t.assets.label}</Label>
				<Input
					bind:value={assetDescription}
					placeholder={t.assets.placeholder}
					class="form-control-touch bg-background"
				/>
			</div>
		{/if}
	</section>

	<!-- Vehicles -->
	<section class="form-section-card space-y-4">
		<div class="flex items-center gap-2">
			<Car class="size-5 text-primary" />
			<h3 class="text-base font-bold text-foreground">{t.vehicles.title}</h3>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {!hasVehicles
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				onclick={() => {
					hasVehicles = false;
					vehicleRows = [];
				}}
			>
				{t.vehicles.hasVehiclesNo}
			</button>
			<button
				type="button"
				class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {hasVehicles
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				onclick={() => {
					hasVehicles = true;
					if (vehicleRows.length === 0) addVehicle();
				}}
			>
				{t.vehicles.hasVehicles}
			</button>
		</div>
		{#if hasVehicles}
			<div class="space-y-2">
				{#each vehicleRows as vehicle (vehicle.id)}
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Select.Root type="single" bind:value={vehicle.type}>
							<Select.Trigger class="{selectTriggerClass} sm:w-36 sm:shrink-0">
								{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ??
									t.vehicles.typeLabel}
							</Select.Trigger>
							<Select.Content>
								{#each vehicleTypeOptions as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<div class="flex flex-1 items-center gap-2">
							<Input
								bind:value={vehicle.license_plate}
								placeholder={t.vehicles.platePlaceholder}
								class="form-control-touch flex-1 bg-background"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								class="touch-target size-12 shrink-0 sm:size-10"
								onclick={() => removeVehicle(vehicle.id)}
							>
								<X class="size-4 text-muted-foreground" />
							</Button>
						</div>
					</div>
				{/each}
				<Button
					type="button"
					variant="outline"
					class="touch-target h-auto w-full gap-2 py-3"
					onclick={addVehicle}
				>
					<Plus class="size-4" />
					{t.vehicles.btnAdd}
				</Button>
			</div>
		{/if}
	</section>

	{#if disclaimerRequired}
		<section class="space-y-3 rounded-xl border-2 border-warning-border bg-warning-subtle/30 p-4">
			<div class="flex items-center gap-2">
				<ShieldAlert class="size-5 text-warning-dark" />
				<h3 class="text-sm font-bold text-foreground">{t.disclaimer.title}</h3>
			</div>
			<div class="space-y-3">
				{#each disclaimerGroups as group (group.label)}
					<div>
						<h4 class="mb-1 text-sm font-semibold text-foreground">{group.label}</h4>
						<ul class="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
							{#each group.items as item, i (i)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
			<label
				class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 border-warning-border bg-card p-3.5"
			>
				<Checkbox
					id="disclaimer-ack"
					checked={disclaimerAcknowledged}
					onCheckedChange={(v) => (disclaimerAcknowledged = v === true)}
					class="mt-0.5 size-5 shrink-0"
				/>
				<span class="text-sm leading-relaxed font-semibold select-none">{t.disclaimer.acknowledge}</span>
			</label>
		</section>
	{/if}

	<div
		class="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
	>
		<Button
			type="button"
			disabled={pending || (disclaimerRequired && !disclaimerAcknowledged)}
			class="touch-target h-auto w-full py-3 text-base font-semibold sm:w-auto sm:px-8"
			onclick={() =>
				onNext({
					pets: buildPetGroups(),
					assetDescription: hasAssets ? assetDescription : '',
					vehicles: hasVehicles
						? vehicleRows.map((v) => ({
								type: v.type,
								license_plate: v.license_plate.trim() || null
							}))
						: []
				})}
		>
			{t.actions.next}
		</Button>
		<Button
			type="button"
			variant="outline"
			class="touch-target h-auto w-full py-3 sm:w-auto sm:px-8"
			onclick={onBack}
		>
			{t.actions.back}
		</Button>
	</div>
</div>
