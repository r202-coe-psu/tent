<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter, type Zone } from '$lib/features/shelters/index.js';
	import type { Evacuee } from '../domain/people';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
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
	let showOtherZones = $state(false);

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const shelterQuery = safeQuery(
		() => useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode()),
		{ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<
			typeof useShelter
		>
	);

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

	$effect(() => {
		if (recommendedZone && !selectedZone) {
			selectedZone = recommendedZone.code;
		}
	});

	function zoneTypeLabel(type: string | undefined) {
		return type === 'vulnerable' ? t.typeVulnerable : t.typeGeneral;
	}

	function selectZone(code: string) {
		selectedZone = code;
	}
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
	{:else if shelterQuery.isLoading}
		<p class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
			<Loader2 class="size-5 animate-spin" />
			{t.loading}
		</p>
	{:else if activeZones.length === 0}
		<p class="py-8 text-center text-base font-medium text-muted-foreground" role="status">
			{t.noZones}
		</p>
	{:else}
		<div class="space-y-4">
			<p class="text-center text-sm font-medium text-muted-foreground">{t.recommendedHeader}</p>

			{#if recommendedZone}
				{@const isRecommendedSelected = selectedZone === recommendedZone.code}
				<div
					class="form-section-card space-y-3 {isRecommendedSelected && !showOtherZones
						? 'border-2 border-success-border ring-2 ring-success-muted'
						: ''}"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<MapPin class="size-5 shrink-0 text-primary" />
								<h3 class="text-xl font-bold text-foreground">{recommendedZone.name}</h3>
							</div>
							<p class="text-sm text-muted-foreground">
								{t.recommendedNote(zoneTypeLabel(recommendedZone.type))}
							</p>
						</div>
						{#if isRecommendedSelected && !showOtherZones}
							<span
								class="inline-flex shrink-0 items-center gap-1 rounded-full border border-success-border bg-success-muted px-2.5 py-1 text-xs font-bold text-success-dark"
							>
								<Check class="size-3.5" />
								เลือกแล้ว
							</span>
						{/if}
					</div>

					{#if !showOtherZones}
						<Button
							type="button"
							disabled={pending}
							class="touch-target h-auto w-full py-3 text-base font-semibold"
							onclick={() => onSubmit(recommendedZone.code)}
						>
							{pending ? t.btnSaving : t.btnConfirmRecommended}
						</Button>
					{/if}
				</div>
			{/if}

			{#if activeZones.length > 1}
				<Button
					type="button"
					variant="outline"
					class="touch-target h-auto w-full gap-2 py-3"
					onclick={() => {
						showOtherZones = !showOtherZones;
						if (!showOtherZones && recommendedZone) {
							selectedZone = recommendedZone.code;
						}
					}}
				>
					<ChevronDown class="size-4 transition-transform {showOtherZones ? 'rotate-180' : ''}" />
					{showOtherZones ? t.btnHideOtherZones : t.btnOtherZones}
				</Button>
			{/if}

			{#if showOtherZones}
				<div class="space-y-2">
					<p class="text-sm font-semibold text-foreground">{t.otherZonesTitle}</p>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each activeZones as zone (zone.code)}
							{@const selected = selectedZone === zone.code}
							<button
								type="button"
								class="touch-target flex items-center justify-between gap-2 rounded-xl border-2 px-4 py-3 text-left transition-colors {selected
									? 'border-primary bg-primary-muted text-foreground'
									: 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'}"
								onclick={() => selectZone(zone.code)}
							>
								<span class="font-medium">{zone.name}</span>
								<span class="text-xs text-muted-foreground">{zoneTypeLabel(zone.type)}</span>
							</button>
						{/each}
					</div>

					<Button
						type="button"
						disabled={!selectedZone || pending}
						class="touch-target h-auto w-full py-3 text-base font-semibold"
						onclick={() => onSubmit(selectedZone)}
					>
						{pending ? t.btnSaving : t.btnConfirm}
					</Button>
				</div>
			{/if}
		</div>
	{/if}

	<div class="flex flex-col gap-3 border-t border-border pt-6">
		<Button
			type="button"
			variant="outline"
			class="touch-target h-auto w-full py-3"
			onclick={onBack}
			disabled={pending}
		>
			{t.back}
		</Button>
	</div>
</div>
