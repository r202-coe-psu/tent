<script lang="ts">
	import CircleCheckBig from '@lucide/svelte/icons/circle-check-big';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Package from '@lucide/svelte/icons/package';
	import { Button } from '$lib/components/ui/button';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import {
		buildDonationMap,
		type DonationMapPoint,
		type DonationNeedsEntry
	} from '../domain/donation-map';
	import { toUiShelterStatus } from '../domain/mappers';
	import { usePublicShelters } from '../application/queries';
	import ShelterMap from './shelter-map.svelte';

	const MAX_NEEDS_ON_CARD = 3;

	let {
		needs,
		selectedCode,
		lockedCode = null,
		pointsByShelter = {},
		loading = false,
		labelledBy,
		unitLabel = (unit: string) => unit,
		onSelect
	}: {
		/** Shelters that take donations, as `GET /api/public/v1/needs` returns them. */
		needs: DonationNeedsEntry[];
		selectedCode: string;
		/** A need card already fixed the destination: only that shelter is offered. */
		lockedCode?: string | null;
		/** Drop-off points keyed by shelter code. They get their own pins and open that shelter's card. */
		pointsByShelter?: Record<string, DonationMapPoint[]>;
		loading?: boolean;
		labelledBy: string;
		unitLabel?: (unit: string) => string;
		onSelect: (code: string, name: string) => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const sheltersQuery = usePublicShelters(() => ({}));

	let mapFailed = $state(false);
	let focusedCode = $state<string | null>(null);
	let focusedPointId = $state<string | null>(null);

	const model = $derived(
		buildDonationMap(needs, sheltersQuery.data?.shelters ?? [], lockedCode, pointsByShelter)
	);
	const allShelters = $derived([...model.onMap, ...model.withoutGeo]);
	const mapShelters = $derived(
		model.onMap.map((shelter) => ({
			id: shelter.code,
			code: shelter.code,
			name: shelter.name,
			status: toUiShelterStatus(shelter.status),
			site_kind: shelter.siteKind,
			geo: shelter.geo,
			distance: null
		}))
	);
	const mapPoints = $derived(model.onMap.flatMap((shelter) => shelter.points));

	const cardCode = $derived(focusedCode ?? (selectedCode || null));
	const card = $derived(allShelters.find((shelter) => shelter.code === cardCode) ?? null);
	const cardPoint = $derived(card?.points.find((point) => point.id === focusedPointId) ?? null);

	const showMap = $derived(model.onMap.length > 0 && !mapFailed && !sheltersQuery.isError);
	const mapUnavailable = $derived(mapFailed || sheltersQuery.isError);

	function focusShelter(code: string) {
		focusedCode = code || null;
		focusedPointId = null;
	}

	function focusPoint(pointId: string) {
		const point = mapPoints.find((candidate) => candidate.id === pointId);
		if (!point) return;
		focusedCode = point.shelterCode;
		focusedPointId = point.id;
	}

	function choose(code: string, name: string) {
		focusShelter(code);
		onSelect(code, name);
	}
</script>

<div class="space-y-3">
	{#if showMap}
		<div
			class="relative h-72 w-full overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100 sm:h-96"
			role="region"
			aria-label={t.shelterPickerMapLabel}
			data-testid="donation-shelter-map"
		>
			<ShelterMap
				shelters={mapShelters}
				points={mapPoints}
				selectedId={cardCode}
				disablePopup
				showLegend={false}
				cooperativeGestures
				onSelectShelter={focusShelter}
				onSelectPoint={focusPoint}
				onLoadError={() => (mapFailed = true)}
			/>
		</div>
		<p class="text-xs font-medium text-slate-500">{t.shelterPickerMapHint}</p>
	{:else if sheltersQuery.isPending && needs.length > 0}
		<div class="h-72 w-full animate-pulse rounded-xl bg-slate-100 sm:h-96" aria-hidden="true"></div>
	{:else if mapUnavailable}
		<p class="rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-600">
			{t.shelterPickerMapUnavailable}
		</p>
	{/if}

	{#if card}
		<div
			class="space-y-3 rounded-xl border-2 border-slate-200 bg-white p-4"
			aria-live="polite"
			data-testid="donation-shelter-card"
		>
			<div>
				<p class="text-base font-bold text-slate-900">{card.name}</p>
				{#if card.areaLabel}
					<p class="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
						<MapPin class="h-3 w-3 shrink-0" />
						{card.areaLabel}
					</p>
				{/if}
				{#if cardPoint}
					<div class="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
						<p class="font-bold">{t.shelterPickerPoint}: {cardPoint.label}</p>
						{#if cardPoint.description}
							<p class="mt-0.5">{cardPoint.description}</p>
						{/if}
					</div>
				{/if}
			</div>

			<div>
				<p class="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
					<Package class="h-3.5 w-3.5" />
					{t.shelterPickerNeedsTitle}
				</p>
				{#if card.needs.length === 0}
					<p class="text-xs text-slate-500">{t.shelterPickerNoNeeds}</p>
				{:else}
					<ul class="space-y-1 text-xs text-slate-700">
						{#each card.needs.slice(0, MAX_NEEDS_ON_CARD) as need (need.itemId)}
							<li class="flex justify-between gap-3">
								<span class="min-w-0 truncate">{need.name}</span>
								<span class="shrink-0 font-semibold">
									{need.qtyNeeded}
									{unitLabel(need.unit)}
								</span>
							</li>
						{/each}
					</ul>
					{#if card.needs.length > MAX_NEEDS_ON_CARD}
						<p class="mt-1 text-xs text-slate-500">
							{t.shelterPickerMoreNeeds.replace(
								'{n}',
								String(card.needs.length - MAX_NEEDS_ON_CARD)
							)}
						</p>
					{/if}
				{/if}
			</div>

			{#if card.code === selectedCode}
				<p class="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
					<CircleCheckBig class="h-4 w-4" />
					{t.shelterPickerSelected}
				</p>
			{:else}
				<Button
					type="button"
					class="w-full"
					data-testid="donation-shelter-choose"
					onclick={() => choose(card.code, card.name)}
				>
					{t.shelterPickerSelect}
				</Button>
			{/if}
		</div>
	{/if}

	<div role="radiogroup" aria-labelledby={labelledBy} class="space-y-2">
		{#if allShelters.length === 0}
			<p class="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
				{loading ? t.loadingNeeds : t.shelterPickerEmpty}
			</p>
		{/if}
		{#each allShelters as shelter (shelter.code)}
			<label
				class="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-slate-200 bg-white p-3 text-sm has-checked:border-domain-donation has-checked:bg-white has-focus-visible:ring-2 has-focus-visible:ring-domain-donation/40 has-disabled:cursor-not-allowed"
			>
				<input
					type="radio"
					name="donation-shelter"
					class="mt-1 h-4 w-4 shrink-0 accent-domain-donation"
					value={shelter.code}
					checked={shelter.code === selectedCode}
					disabled={Boolean(lockedCode)}
					onchange={() => choose(shelter.code, shelter.name)}
				/>
				<span class="min-w-0">
					<span class="block font-bold text-slate-800">{shelter.name}</span>
					{#if shelter.areaLabel}
						<span class="block text-xs text-slate-500">{shelter.areaLabel}</span>
					{/if}
					{#if !shelter.geo && sheltersQuery.isSuccess}
						<span class="block text-xs text-slate-400">{t.shelterPickerNoGeo}</span>
					{/if}
				</span>
			</label>
		{/each}
	</div>
</div>
