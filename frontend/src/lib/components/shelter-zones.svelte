<script lang="ts">
	import Layers from '@lucide/svelte/icons/layers';
	import Dog from '@lucide/svelte/icons/dog';
	import Users from '@lucide/svelte/icons/users';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import type { PublicShelterDetail } from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_DETAILS_I18N } from '$lib/constants/i18n';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();

	function getZoneName(type: string | undefined): string {
		switch (type) {
			case 'general':
				return t.generalZone;
			case 'male':
				return t.maleZone;
			case 'female':
				return t.femaleZone;
			case 'family':
				return t.familyZone;
			case 'pet':
				return t.petZone;
			case 'vulnerable':
				return t.vulnerableZone;
			case 'quarantine':
				return t.quarantineZone;
			case 'kitchen':
				return t.kitchenZone;
			case 'storage':
				return t.storageZone;
			case 'admin':
				return t.adminZone;
			case 'medical':
				return t.medicalZone;
			default:
				return `${t.zonePrefix} ${type || t.unspecified}`;
		}
	}

	let t = $derived(getTranslation(PUBLIC_SHELTER_DETAILS_I18N, langState.current));
</script>

{#if shelter.zones && shelter.zones.length > 0}
	<section>
		<div class="mb-4 flex items-center gap-2">
			<Layers class="text-accent-blue h-5 w-5" />
			<h2 class="text-lg font-bold text-foreground">{t.internalShelterZones}</h2>
		</div>

		<div class="grid grid-cols-1 gap-3">
			{#each shelter.zones as zone, i (i)}
				<div
					class="flex items-center justify-between rounded-xl border border-border bg-white p-4 shadow-sm"
				>
					<div class="flex items-center gap-3">
						<div
							class="bg-accent-blue/10 text-accent-blue flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
						>
							{#if zone.type === 'pet'}
								<Dog class="h-5 w-5" />
							{:else if zone.type === 'vulnerable' || zone.type === 'quarantine'}
								<HeartPulse class="h-5 w-5 text-danger" />
							{:else}
								<Users class="h-5 w-5" />
							{/if}
						</div>
						<div>
							<h3 class="text-sm font-bold text-foreground">
								{#if zone.name}
									<span class="mr-1">{zone.name}</span>
									<span class="font-normal text-muted-foreground">
										({getZoneName(zone.type)})
									</span>
								{:else}
									{getZoneName(zone.type)}
								{/if}
							</h3>
							<p class="text-xs text-muted-foreground">
								{#if zone.area_m2}{t.area} {zone.area_m2} {t.sqm}{/if}
							</p>
						</div>
					</div>
					<div class="text-right">
						{#if zone.capacity}
							<div class="text-sm font-bold text-foreground">{zone.capacity}</div>
							<div class="text-xs text-muted-foreground">{t.people}</div>
						{:else}
							<div class="text-sm text-muted-foreground">-</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}
