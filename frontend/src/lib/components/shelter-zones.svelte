<script lang="ts">
	import Layers from '@lucide/svelte/icons/layers';
	import Dog from '@lucide/svelte/icons/dog';
	import Users from '@lucide/svelte/icons/users';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import {
		publicZoneOccupancy,
		type PublicShelterDetail,
		type PublicZoneOccupancyLevel
	} from '$lib/features/public-portal';
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

	// Per-zone Present headcount (#1241); `null` until the worker has projected it.
	const zones = $derived(
		(shelter.zones ?? []).map((zone) => {
			const occupancy = publicZoneOccupancy(zone);
			// Bar and level only when the capacity is known — otherwise the headcount alone.
			const fill =
				occupancy?.level != null && occupancy.percent !== null
					? { level: occupancy.level, percent: occupancy.percent }
					: null;
			return { zone, closed: zone.status === 'closed', occupancy, fill };
		})
	);

	const BAR: Record<PublicZoneOccupancyLevel, string> = {
		normal: 'bg-emerald-500',
		warning: 'bg-amber-500',
		full: 'bg-red-500'
	};
	const BADGE: Record<PublicZoneOccupancyLevel, string> = {
		normal: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		warning: 'border-amber-200 bg-amber-50 text-amber-900',
		full: 'border-red-200 bg-red-50 text-red-900'
	};
	const levelLabel = $derived<Record<PublicZoneOccupancyLevel, string>>({
		normal: t.zoneLevelNormal,
		warning: t.zoneLevelWarning,
		full: t.zoneLevelFull
	});
</script>

{#if zones.length > 0}
	<section>
		<div class="mb-4 flex items-center gap-2">
			<Layers class="text-accent-blue h-5 w-5" />
			<h2 class="text-lg font-bold text-foreground">{t.internalShelterZones}</h2>
		</div>

		<div class="grid grid-cols-1 gap-3">
			{#each zones as { zone, closed, occupancy, fill }, i (zone.code ?? i)}
				<div
					class={[
						'space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm',
						closed && 'opacity-60'
					]}
				>
					<div class="flex items-center justify-between gap-3">
						<div class="flex min-w-0 items-center gap-3">
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
							<div class="min-w-0">
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
						<div class="shrink-0 text-right">
							{#if occupancy}
								<div class="text-sm font-bold text-foreground tabular-nums">
									{occupancy.present.toLocaleString()}
									{#if occupancy.capacity !== null}
										<span class="font-normal text-muted-foreground">
											{t.zoneOccupancyOf}
											{occupancy.capacity.toLocaleString()}
										</span>
									{/if}
								</div>
								<div class="text-xs text-muted-foreground">{t.people}</div>
							{:else if zone.capacity}
								<div class="text-sm font-bold text-foreground tabular-nums">{zone.capacity}</div>
								<div class="text-xs text-muted-foreground">{t.people}</div>
							{:else}
								<div class="text-sm text-muted-foreground">-</div>
							{/if}
						</div>
					</div>
					{#if closed || fill}
						<div class="flex items-center gap-3">
							{#if fill}
								<div class="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
									<div
										class={[
											'h-full rounded-full transition-all duration-300',
											closed ? 'bg-slate-400' : BAR[fill.level]
										]}
										style:width="{Math.min(100, fill.percent)}%"
									></div>
								</div>
							{/if}
							{#if closed}
								<span
									class="ml-auto min-w-32 shrink-0 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-center text-xs font-semibold text-slate-700"
								>
									{t.zoneClosed}
								</span>
							{:else if fill}
								<span
									class="min-w-32 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-semibold tabular-nums {BADGE[
										fill.level
									]}"
								>
									{levelLabel[fill.level]} · {fill.percent}%
								</span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}
