<script lang="ts">
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import {
		buildDonationMap,
		donationMapPointsOf,
		type MapPointFocus
	} from '../domain/donation-map';
	import { toUiShelterStatus } from '../domain/mappers';
	import { usePublicShelter, usePublicShelters } from '../application/queries';
	import ShelterMap from './shelter-map.svelte';

	let {
		shelterCode,
		shelterName = '',
		focusPointId = null
	}: {
		shelterCode: string;
		shelterName?: string;
		/** Point to zoom the map to (the caller's first group with a point, CR-206 A2 FR-AP-12). */
		focusPointId?: string | null;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const sheltersQuery = usePublicShelters(() => ({}));
	// The list carries no drop-off points (CR-205 FR-DP-14), so the locked shelter's own
	// detail adds them: one request for this shelter only (FR-DP-18).
	const shelterQuery = usePublicShelter(() => shelterCode);
	const points = $derived(donationMapPointsOf(shelterCode, shelterQuery.data?.donation_points));

	let mapFailed = $state(false);
	// A tapped pin only names its point: staff, not the donor, decide where each line goes
	// (staff-assigned drop-off FR-AP-11).
	let tapped = $state<MapPointFocus | null>(null);
	let focusSeq = 0;
	// A tap wins over the zoom the caller asked for; the zoom alone shows no note.
	const focus = $derived<MapPointFocus | null>(
		tapped ?? (focusPointId ? { pointId: focusPointId, zoom: true, seq: 0 } : null)
	);

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
	const focusedPoint = $derived(shelter?.points.find((point) => point.id === tapped?.pointId));
</script>

{#if shelter && !mapFailed && !sheltersQuery.isError}
	<div class="space-y-2">
		<div
			class="relative h-64 w-full overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100 sm:h-80"
			role="region"
			aria-label={t.dropOffMapLabel}
			data-testid="drop-off-shelter-map"
		>
			<ShelterMap
				shelters={mapShelters}
				points={shelter.points}
				selectedId={shelter.code}
				pointFocus={focus}
				disablePopup
				showLegend={false}
				cooperativeGestures
				onSelectPoint={(pointId) => (tapped = { pointId, zoom: false, seq: ++focusSeq })}
				onLoadError={() => (mapFailed = true)}
			/>
		</div>
		<!-- A live region that is always there, so a tap is read out (owner 2026-10-30). -->
		<div role="status" aria-live="polite">
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
	</div>
{/if}
