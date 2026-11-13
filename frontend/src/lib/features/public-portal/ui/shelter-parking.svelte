<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import type { PublicShelterDetail } from '../domain/types';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		PUBLIC_SHELTER_DETAILS_I18N,
		vehicleCapacityText,
		vehicleLabel
	} from '$lib/constants/i18n';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();
	let t = $derived(getTranslation(PUBLIC_SHELTER_DETAILS_I18N, langState.current));

	const points = $derived(shelter.parking_points ?? []);
</script>

{#if points.length > 0}
	<section data-testid="shelter-parking">
		<div class="mb-4 flex items-center gap-2">
			<Car class="h-5 w-5 text-primary" />
			<h2 class="text-lg font-bold text-foreground">{t.parkingPoints}</h2>
		</div>

		<div class="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
			{#each points as point (point.id)}
				<div class="border-b border-border/50 p-4 last:border-b-0">
					<div class="text-sm font-bold text-foreground">{point.name}</div>
					{#if point.note}
						<p class="mt-0.5 text-xs text-muted-foreground">{point.note}</p>
					{/if}
					{#each point.vehicles ?? [] as v (v.type)}
						<div class="mt-1 flex items-center justify-between text-sm">
							<span class="text-muted-foreground">{vehicleLabel(v.type, langState.current)}</span>
							<span class="font-semibold text-foreground"
								>{vehicleCapacityText(v.type, v.max_capacity, langState.current)}</span
							>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</section>
{/if}
