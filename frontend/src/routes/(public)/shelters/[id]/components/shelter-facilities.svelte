<script lang="ts">
	import Droplets from '@lucide/svelte/icons/droplets';
	import Zap from '@lucide/svelte/icons/zap';
	import Signal from '@lucide/svelte/icons/signal';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Car from '@lucide/svelte/icons/car';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import type { PublicShelterDetail } from '$lib/features/public-portal';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_DETAILS_I18N } from '$lib/constants/i18n';

	let t = $derived(getTranslation(PUBLIC_SHELTER_DETAILS_I18N, langState.current));
</script>

<section>
	<div class="mb-4 flex items-center gap-2">
		<Droplets class="h-5 w-5 text-primary" />
		<h2 class="text-lg font-bold text-foreground">{t.facilitiesCommonAreas}</h2>
	</div>

	<div class="flex flex-col gap-4">
		<!-- Hygiene -->
		<div class="rounded-xl border border-border bg-white p-5 shadow-sm">
			<h3 class="mb-3 text-sm font-bold text-foreground">{t.hygieneLabel}</h3>
			<div class="mb-3 flex flex-wrap gap-3 text-sm">
				<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
					<span class="text-muted-foreground">{t.maleToilets}</span>
					<span class="ml-1 font-bold">{shelter.facilities?.hygiene?.male ?? '-'} {t.rooms}</span>
				</div>
				<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
					<span class="text-muted-foreground">{t.femaleToilets}</span>
					<span class="ml-1 font-bold">{shelter.facilities?.hygiene?.female ?? '-'} {t.rooms}</span>
				</div>
				<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
					<span class="text-muted-foreground">{t.accessibleToilets}:</span>
					<span class="ml-1 font-bold"
						>{shelter.facilities?.hygiene?.accessible ?? '-'} {t.rooms}</span
					>
				</div>
				<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
					<span class="text-muted-foreground">{t.showers}:</span>
					<span class="ml-1 font-bold">{shelter.facilities?.hygiene?.shower ?? '-'} {t.rooms}</span>
				</div>
			</div>
			{#if (shelter.facilities?.hygiene?.mobile_toilet ?? 0) > 0}
				<div class="flex flex-wrap gap-2">
					<div
						class="inline-flex items-center gap-1.5 rounded-md bg-success-muted px-2 py-1 text-xs font-bold text-success-dark"
					>
						<CheckCircle2 class="h-3 w-3" />
						{t.mobileToiletsAvailable}
					</div>
					<span class="text-xs text-muted-foreground"
						>{t.amountLabel} {shelter.facilities?.hygiene?.mobile_toilet} {t.spots}</span
					>
				</div>
			{/if}
		</div>

		<!-- Power & Comms Grid -->
		<div class="grid grid-cols-2 gap-4">
			<div class="rounded-xl border border-border bg-white p-4 shadow-sm">
				<div class="mb-3 flex items-center gap-1.5">
					<Zap class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">{t.powerWater}</h3>
				</div>
				<div class="space-y-2 text-xs">
					<div class="flex justify-between border-b border-border/50 pb-1">
						<span class="text-muted-foreground">{t.mainPower}</span>
						<span class="ml-2 text-right font-bold">
							{#if shelter.facilities?.power === 'generator'}
								{t.generator}
							{:else if shelter.facilities?.power === 'solar'}
								{t.solar}
							{:else if shelter.facilities?.power === 'city_grid'}
								{t.cityGrid}
							{:else}
								{t.noData}
							{/if}
						</span>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">{t.waterSupply}</span>
						<span class="ml-2 text-right font-bold">
							{#if shelter.facilities?.water === 'groundwater'}
								{t.groundwater}
							{:else if shelter.facilities?.water === 'water_tank'}
								{t.waterTruck}
							{:else if shelter.facilities?.water === 'city_water'}
								{t.cityWater}
							{:else}
								{t.noData}
							{/if}
						</span>
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-border bg-white p-4 shadow-sm">
				<div class="mb-3 flex items-center gap-1.5">
					<Signal class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">{t.communications}</h3>
				</div>
				<div class="space-y-2 text-xs">
					<div class="flex justify-between border-b border-border/50 pb-1">
						<span class="text-muted-foreground">{t.cellularSignal}</span>
						<span class="ml-2 text-right font-bold"
							>{shelter.facilities?.comms?.includes('cellular') ? t.yes : t.no}</span
						>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">VHF</span>
						<span class="ml-2 text-right font-bold"
							>{shelter.facilities?.comms?.includes('vhf_radio') ? t.yes : t.no}</span
						>
					</div>
				</div>
			</div>
		</div>

		<!-- Badges -->
		<div class="mt-1 flex flex-wrap gap-3">
			{#if shelter.facilities?.kitchen}
				<div
					class="flex items-center gap-1.5 rounded-xl bg-warning px-3 py-2 text-sm font-bold text-warning-foreground shadow-sm"
				>
					<ChefHat class="h-4 w-4 shrink-0" />
					{shelter.facilities.kitchen === 'central_kitchen' ? t.centralKitchen : t.noKitchen}
				</div>
			{/if}
			{#if shelter.facilities?.parking}
				<div
					class="flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-2 text-sm font-bold text-foreground/90 shadow-sm"
				>
					<Car class="h-4 w-4 shrink-0" />
					{shelter.facilities.parking}
					{t.spots}
				</div>
			{/if}
		</div>
	</div>
</section>
