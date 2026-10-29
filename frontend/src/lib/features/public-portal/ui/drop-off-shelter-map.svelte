<script lang="ts">
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import { buildDonationMap, donationMapPointsOf } from '../domain/donation-map';
	import { toUiShelterStatus } from '../domain/mappers';
	import { usePublicShelter, usePublicShelters } from '../application/queries';
	import ShelterMap from './shelter-map.svelte';

	let {
		shelterCode,
		shelterName = ''
	}: {
		shelterCode: string;
		shelterName?: string;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const sheltersQuery = usePublicShelters(() => ({}));
	// The list carries no drop-off points (CR-205 FR-DP-14), so the locked shelter's own
	// detail adds them: one request for this shelter only (FR-DP-18).
	const shelterQuery = usePublicShelter(() => shelterCode);
	const points = $derived(donationMapPointsOf(shelterCode, shelterQuery.data?.donation_points));

	let mapFailed = $state(false);
	let focusedPointId = $state<string | null>(null);

	const shelter = $derived(
		buildDonationMap(
			[{ code: shelterCode, name: shelterName || shelterCode, needs: [] }],
			sheltersQuery.data?.shelters ?? [],
			shelterCode,
			{ [shelterCode]: points }
		).onMap[0] ?? null
	);
	const mapShelters = $derived(
		shelter
			? [
					{
						id: shelter.code,
						code: shelter.code,
						name: shelter.name,
						status: toUiShelterStatus(shelter.status),
						site_kind: shelter.siteKind,
						geo: shelter.geo,
						distance: null
					}
				]
			: []
	);
	const focusedPoint = $derived(shelter?.points.find((point) => point.id === focusedPointId));
</script>

{#if shelter && !mapFailed && !sheltersQuery.isError}
	<div class="space-y-2">
		<div
			class="relative h-48 w-full overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100 sm:h-56"
			role="region"
			aria-label={t.dropOffMapLabel}
			data-testid="drop-off-shelter-map"
		>
			<ShelterMap
				shelters={mapShelters}
				points={shelter.points}
				selectedId={shelter.code}
				disablePopup
				showLegend={false}
				cooperativeGestures
				onSelectPoint={(id) => (focusedPointId = id)}
				onLoadError={() => (mapFailed = true)}
			/>
		</div>
		{#if focusedPoint}
			<div
				class="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900"
				data-testid="drop-off-point-note"
			>
				<p class="font-bold">{focusedPoint.label}</p>
				{#if focusedPoint.description}
					<p class="mt-0.5">{focusedPoint.description}</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
