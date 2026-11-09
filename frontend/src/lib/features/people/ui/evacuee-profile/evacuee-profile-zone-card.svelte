<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { Evacuee } from '$lib/features/people';
	import { zoneLabel } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';

	let {
		evacuee,
		shelterName,
		readonly,
		onOpenEdit
	}: {
		evacuee: Evacuee;
		shelterName: string;
		readonly: boolean;
		onOpenEdit: () => void;
	} = $props();

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).zoneCard);
</script>

<section class="space-y-4 rounded-lg border border-border bg-card p-5">
	<div class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2.5">
			<MapPin class="size-4.5 text-primary" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">{t.title}</h3>
		</div>
		{#if !readonly}
			<button
				type="button"
				aria-label={t.editAria}
				title={t.editAria}
				onclick={onOpenEdit}
				class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>
	<div class="min-w-0 space-y-3.5">
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.shelter}</span>
			<span class="mt-0.5 block text-sm font-bold break-words text-slate-800 dark:text-slate-200">
				{shelterName}
			</span>
		</div>
		<div class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
			<div class="min-w-0">
				<span class="block text-xs font-medium text-muted-foreground">{t.livingZone}</span>
				<span
					class="mt-1 inline-block max-w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold break-words text-blue-600 dark:border-blue-900/30 dark:bg-blue-950/40 dark:text-blue-400"
				>
					{t.zone(zoneLabel(evacuee.current_stay.zone, shelterZones))}
				</span>
			</div>
			<div class="min-w-0">
				<span class="block text-xs font-medium text-muted-foreground">{t.bedSpot}</span>
				<span class="mt-1 block text-sm font-semibold text-slate-800 dark:text-slate-200">-</span>
			</div>
		</div>
	</div>
</section>
