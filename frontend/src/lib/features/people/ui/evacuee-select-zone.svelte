<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter, type Zone } from '$lib/features/shelters/index.js';
	import type { Evacuee } from '../domain/people';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_SELECT_ZONE_I18N } from './_constants/evacuee-select-zone.i18n';

	let {
		evacuee,
		pending = false,
		onBack,
		onSubmit
	}: {
		evacuee?: Evacuee | null;
		pending?: boolean;
		onBack: () => void;
		onSubmit: (zone: string) => void;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_SELECT_ZONE_I18N, languageStore.current));

	let selectedZone = $state('');

	// Query current shelter data to get zones
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());

	// Filter only active zones
	let activeZones = $derived(
		(shelterQuery.data?.zones || []).filter((z: Zone) => z.status !== 'closed')
	);

	const recommendedZoneType = $derived.by(() => {
		if (evacuee?.special_needs && evacuee.special_needs.length > 0) {
			return 'vulnerable';
		}
		return 'general';
	});

	const recommendedZone = $derived.by(() => {
		const matches = activeZones.filter((z: Zone) => (z.type || 'general') === recommendedZoneType);
		if (matches.length > 0) return matches[0];
		return activeZones[0] || null;
	});

	// Automatically select the recommended zone initially
	$effect(() => {
		if (recommendedZone && !selectedZone) {
			selectedZone = recommendedZone.code;
		}
	});
</script>

<div class="space-y-6">
	{#if shelterQuery.isError}
		<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">{t.errorTitle}</Alert.Title>
			<Alert.Description class="space-y-3">
				<p>{t.errorDesc}</p>
				<Button type="button" variant="outline" size="sm" onclick={() => shelterQuery.refetch()}>
					{t.retry}
				</Button>
			</Alert.Description>
		</Alert.Root>
	{:else}
		<div class="space-y-3 text-center">
			<p class="text-base font-medium text-foreground">{t.recommendedHeader}</p>
			{#if shelterQuery.isLoading}
				<p class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" />
					{t.loading}
				</p>
			{:else if recommendedZone}
				<p class="text-2xl font-bold">
					<span class="mr-1">{recommendedZone.type === 'vulnerable' ? '🟣' : '🟢'}</span>
					{recommendedZone.name}
				</p>
				<p class="text-xs text-muted-foreground">
					{t.recommendedNote(
						recommendedZone.type === 'vulnerable' ? t.typeVulnerable : t.typeGeneral
					)}
				</p>
			{:else}
				<p class="text-base font-semibold text-muted-foreground" role="status">
					{t.noZones}
				</p>
			{/if}
		</div>

		{#if activeZones.length > 0}
			<div class="mx-auto w-full max-w-sm">
				<Select.Root type="single" bind:value={selectedZone}>
					<Select.Trigger class="h-12 w-full rounded-xl border-border bg-background">
						{@const currentZone = activeZones.find((z: Zone) => z.code === selectedZone)}
						<span class="flex items-center gap-2 text-base font-medium">
							{currentZone ? `📍 ${currentZone.name}` : t.selectPlaceholder}
						</span>
					</Select.Trigger>
					<Select.Content class="rounded-xl">
						{#each activeZones as zone (zone.code)}
							<Select.Item value={zone.code} class="text-base font-medium">
								📍 {zone.name}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
	{/if}

	<div class="flex flex-col gap-3 border-t border-border pt-6">
		<Button
			type="button"
			disabled={!selectedZone || shelterQuery.isLoading || shelterQuery.isError || pending}
			class="h-12 w-full rounded-xl bg-[#003B71] text-sm font-medium hover:bg-[#002a50] md:text-base"
			onclick={() => onSubmit(selectedZone)}
		>
			{pending ? t.btnSaving : t.btnConfirm}
		</Button>
		<Button
			type="button"
			variant="outline"
			class="h-12 w-full rounded-xl text-sm font-medium md:text-base"
			onclick={onBack}
			disabled={pending}
		>
			{t.back}
		</Button>
	</div>
</div>
