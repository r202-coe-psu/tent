<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import type { UnifiedHouseholdInput } from '../../domain/unified-registration';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';

	/** Zod input vehicles allow omitted `license_plate` (defaulted on parse). */
	type FormVehicle = NonNullable<UnifiedHouseholdInput['vehicles']>[number];

	let {
		vehicles = $bindable<FormVehicle[]>(),
		assetDescription = $bindable<string>(),
		pending = false,
		onDirty
	}: {
		vehicles: FormVehicle[];
		assetDescription: string;
		pending?: boolean;
		onDirty?: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	function addVehicle() {
		if (pending) return;
		vehicles = [...vehicles, { type: 'car', license_plate: '' }];
		onDirty?.();
	}

	function removeVehicle(index: number) {
		if (pending) return;
		vehicles = vehicles.filter((_, i) => i !== index);
		onDirty?.();
	}
</script>

<UnifiedRegistrationSection
	id="unified-vehicles"
	title={t.sectionVehicles}
	description={t.sectionVehiclesDesc}
	badge={vehicles.length > 0
		? `${vehicles.length}${t.vehicleCountUnit ? ` ${t.vehicleCountUnit}` : ''}`
		: null}
	icon={Package}
>
	{#snippet actions()}
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={pending}
			onclick={addVehicle}
			class="h-8 gap-1 text-xs"
		>
			<Plus class="size-3.5" />
			{t.addVehicle}
		</Button>
	{/snippet}

	{#if vehicles.length === 0}
		<p class="text-xs text-muted-foreground">{t.vehicleEmpty}</p>
	{:else}
		<div class="space-y-2">
			{#each vehicles as vehicle, index (index)}
				<div
					class="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-slate-50/50 p-2.5"
				>
					<div class="w-[140px] shrink-0 space-y-1">
						<Label class="text-2xs text-muted-foreground">{t.vehicleTypeLabel}</Label>
						<Select.Root
							type="single"
							value={vehicle.type}
							onValueChange={(val) => {
								if (val === 'car' || val === 'motorcycle' || val === 'other') {
									vehicle.type = val;
									vehicles = [...vehicles];
									onDirty?.();
								}
							}}
							disabled={pending}
						>
							<Select.Trigger class="!h-8 w-full rounded-md text-xs">
								{vehicle.type === 'car'
									? t.vehicleTypeCar
									: vehicle.type === 'motorcycle'
										? t.vehicleTypeMotorcycle
										: t.vehicleTypeOther}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="car" label={t.vehicleTypeCar} />
								<Select.Item value="motorcycle" label={t.vehicleTypeMotorcycle} />
								<Select.Item value="other" label={t.vehicleTypeOther} />
							</Select.Content>
						</Select.Root>
					</div>
					<div class="min-w-[140px] flex-1 space-y-1">
						<Label class="text-2xs text-muted-foreground">{t.licensePlateLabel}</Label>
						<Input
							class="h-8"
							value={vehicle.license_plate ?? ''}
							disabled={pending}
							oninput={(e) => {
								vehicle.license_plate = (e.currentTarget as HTMLInputElement).value;
								vehicles = [...vehicles];
								onDirty?.();
							}}
						/>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						onclick={() => removeVehicle(index)}
						class="h-8 text-xs text-destructive hover:text-destructive"
					>
						<Trash2 class="mr-1 size-3.5" />
						{t.removeBtn}
					</Button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="space-y-1.5 border-t border-border/60 pt-4">
		<Label for="family-assets" class="text-xs font-semibold text-foreground">
			{t.assetsLabel}
		</Label>
		<Textarea
			id="family-assets"
			bind:value={assetDescription}
			disabled={pending}
			rows={2}
			placeholder={t.assetsPlaceholder}
			class="min-h-16 text-sm"
		/>
	</div>
</UnifiedRegistrationSection>
