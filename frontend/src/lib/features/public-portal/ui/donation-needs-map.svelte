<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import MapIcon from '@lucide/svelte/icons/map';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import {
		buildDonationMap,
		donationMapPointsOf,
		donationShelterUrgency,
		type DonationMapShelter,
		type DonationNeedUrgency,
		type DonationNeedsEntry
	} from '../domain/donation-map';
	import { toUiShelterStatus } from '../domain/mappers';
	import { usePublicShelter, usePublicShelters } from '../application/queries';
	import { DONATION_URGENCY_ORDER, DONATION_URGENCY_STYLE } from './donation-urgency';
	import ShelterMap from './shelter-map.svelte';

	type DonationMapPin = { no: number; urgency: DonationNeedUrgency };

	let {
		shelters,
		selectedCode,
		onSelect,
		card
	}: {
		/** Shelters currently on the needs board (after search and filters), in board order. */
		shelters: DonationNeedsEntry[];
		selectedCode: string | null;
		onSelect: (code: string | null) => void;
		/** What opens for the tapped shelter: over the map on wide screens, under it on phones. */
		card: Snippet<[DonationMapShelter, DonationMapPin]>;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const sheltersQuery = usePublicShelters(() => ({}));
	// Drop-off pins only for the tapped shelter, from its own detail (CR-205 FR-DP-18):
	// one request, never one per shelter on the board.
	const selectedQuery = usePublicShelter(() => selectedCode);

	let mapFailed = $state(false);
	// The tapped point's note. Recomputed (back to none) whenever another shelter is
	// picked, so coming back to a shelter does not reopen its old note; a tap overrides it.
	let focusedPointId = $derived.by((): string | null => {
		void selectedCode;
		return null;
	});

	const legendLabel = $derived({
		critical: t.filterCritical,
		high: t.filterHigh,
		normal: t.filterNormal
	});

	const pointsByShelter = $derived(
		selectedCode
			? { [selectedCode]: donationMapPointsOf(selectedCode, selectedQuery.data?.donation_points) }
			: {}
	);
	const onMap = $derived(
		buildDonationMap(shelters, sheltersQuery.data?.shelters ?? [], null, pointsByShelter).onMap
	);
	// A pin's number is its card's place on the board, so shelters without coordinates
	// still take a number and the pins never drift from the cards.
	const pins = $derived(
		new Map(
			onMap.map((shelter) => [
				shelter.code,
				{
					no: shelters.findIndex((entry) => entry.code === shelter.code) + 1,
					urgency: donationShelterUrgency(
						shelters.find((entry) => entry.code === shelter.code)?.needs
					)
				}
			])
		)
	);
	const mapShelters = $derived(
		onMap.map((shelter) => {
			const pin = pins.get(shelter.code)!;
			const style = DONATION_URGENCY_STYLE[pin.urgency];
			return {
				id: shelter.code,
				code: shelter.code,
				name: shelter.name,
				status: toUiShelterStatus(shelter.status),
				site_kind: shelter.siteKind,
				geo: shelter.geo,
				distance: null,
				pin: { label: String(pin.no), fill: style.fill, text: style.text }
			};
		})
	);
	const selected = $derived(onMap.find((shelter) => shelter.code === selectedCode) ?? null);
	const focusedPoint = $derived(selected?.points.find((point) => point.id === focusedPointId));

	const showMap = $derived(onMap.length > 0 && !mapFailed && !sheltersQuery.isError);
	const showUnavailable = $derived(sheltersQuery.isError || mapFailed);
</script>

{#if showMap}
	<section class="space-y-3" aria-labelledby="donation-needs-map-title">
		<div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
			<div class="min-w-0">
				<h2
					id="donation-needs-map-title"
					class="flex items-center gap-2 text-base font-bold text-slate-900"
				>
					<MapIcon class="h-4.5 w-4.5 shrink-0 text-domain-donation-strong" />
					{t.needsMapTitle}
				</h2>
				<p class="mt-0.5 text-xs font-medium text-slate-600">{t.needsMapHint}</p>
			</div>
			<ul
				class="flex items-center gap-3 text-xs font-medium text-slate-600"
				aria-label={t.needsMapLegend}
			>
				{#each DONATION_URGENCY_ORDER as level (level)}
					<li class="flex items-center gap-1.5">
						<span
							class="h-3 w-3 rounded-full border border-white shadow-xs"
							style:background={DONATION_URGENCY_STYLE[level].fill}
						></span>
						{legendLabel[level]}
					</li>
				{/each}
			</ul>
		</div>
		<div class="relative">
			<div
				class="relative h-64 w-full overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-100 sm:h-80 md:h-[460px]"
				role="region"
				aria-label={t.needsMapLabel}
				data-testid="donation-needs-map"
			>
				<ShelterMap
					shelters={mapShelters}
					points={selected?.points ?? []}
					selectedId={selectedCode}
					disablePopup
					showLegend={false}
					cooperativeGestures
					onSelectShelter={(code) => onSelect(code || null)}
					onSelectPoint={(id) => (focusedPointId = id)}
					onLoadError={() => (mapFailed = true)}
				/>
			</div>
			{#if focusedPoint}
				<div
					class="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900"
					data-testid="donation-needs-map-point-note"
				>
					<p class="font-bold">{focusedPoint.label}</p>
					{#if focusedPoint.description}
						<p class="mt-0.5">{focusedPoint.description}</p>
					{/if}
				</div>
			{/if}
			{#if selected}
				<div
					class="relative mt-3 md:absolute md:top-4 md:left-4 md:z-10 md:mt-0 md:max-h-[calc(100%-2rem)] md:w-[400px] md:overflow-y-auto md:rounded-2xl md:shadow-xl"
					data-testid="donation-needs-map-card"
				>
					<button
						type="button"
						onclick={() => onSelect(null)}
						class="absolute top-3 right-3 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
						aria-label={t.needsMapCloseCard}
					>
						<X class="h-4 w-4" />
					</button>
					{@render card(selected, pins.get(selected.code)!)}
				</div>
			{/if}
		</div>
	</section>
{:else if showUnavailable}
	<p class="rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-600">
		{t.needsMapUnavailable}
	</p>
{/if}
