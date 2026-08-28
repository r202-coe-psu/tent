<script lang="ts">
	/* eslint-disable @typescript-eslint/no-explicit-any */
	import { onMount, onDestroy } from 'svelte';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { PublicSiteKind } from '../domain/types';

	import { useShelterTypeLabelMap } from '../application/queries';
	import { DEFAULT_MAP_STYLE, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '$lib/constants/maps';
	import { Button } from '$lib/components/ui/button';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_MAP_I18N } from '$lib/constants/i18n';

	interface ShelterGeo {
		lat: number;
		lng: number;
	}

	interface Shelter {
		id: string;
		name: string;
		status: string;
		capacity: number;
		distance: number;
		site_kind?: PublicSiteKind;
		geo?: ShelterGeo | null;
	}

	let {
		shelters = [],
		userLocation,
		radiusKm,
		center = DEFAULT_MAP_CENTER,
		zoom = DEFAULT_MAP_ZOOM,
		onLocationPick
	}: {
		shelters?: Shelter[];
		userLocation?: { lat?: number | string; lng?: number | string };
		/** Search radius in km; when set with a valid origin, draws a subtle circle. */
		radiusKm?: number;
		center?: [number, number];
		zoom?: number;
		/** Called when the user places a search-origin pin on the map. */
		onLocationPick?: (lat: number, lng: number) => void;
	} = $props();

	const shelterTypeLabels = useShelterTypeLabelMap();

	const SEARCH_RADIUS_SOURCE = 'search-radius';
	const SEARCH_RADIUS_FILL = 'search-radius-fill';
	const SEARCH_RADIUS_LINE = 'search-radius-line';
	const EMPTY_FEATURE_COLLECTION = {
		type: 'FeatureCollection' as const,
		features: [] as never[]
	};

	let mapElement: HTMLElement;
	let mapInstance: any = null;
	let markersLayer: any[] = [];
	let L: any = null;
	let mapLoaded = $state(false);
	let placingPin = $state(false);

	let t = $derived(getTranslation(PUBLIC_SHELTER_MAP_I18N, langState.current));

	/** Approximate a circle as a GeoJSON Polygon (~64 steps), km → degrees by latitude. */
	function circlePolygon(lng: number, lat: number, radiusKmValue: number, steps = 64) {
		const coords: [number, number][] = [];
		const latRad = (lat * Math.PI) / 180;
		const kmPerDegLat = 110.574;
		const kmPerDegLng = 111.32 * Math.cos(latRad);
		const dLat = radiusKmValue / kmPerDegLat;
		const dLng = kmPerDegLng > 0 ? radiusKmValue / kmPerDegLng : 0;

		for (let i = 0; i <= steps; i++) {
			const angle = (i / steps) * 2 * Math.PI;
			coords.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
		}

		return {
			type: 'FeatureCollection' as const,
			features: [
				{
					type: 'Feature' as const,
					properties: {},
					geometry: {
						type: 'Polygon' as const,
						coordinates: [coords]
					}
				}
			]
		};
	}

	function ensureSearchRadiusLayers() {
		if (!mapInstance) return;
		if (!mapInstance.getSource(SEARCH_RADIUS_SOURCE)) {
			mapInstance.addSource(SEARCH_RADIUS_SOURCE, {
				type: 'geojson',
				data: EMPTY_FEATURE_COLLECTION
			});
		}
		if (!mapInstance.getLayer(SEARCH_RADIUS_FILL)) {
			mapInstance.addLayer({
				id: SEARCH_RADIUS_FILL,
				type: 'fill',
				source: SEARCH_RADIUS_SOURCE,
				paint: {
					'fill-color': '#3b82f6',
					'fill-opacity': 0.1
				}
			});
		}
		if (!mapInstance.getLayer(SEARCH_RADIUS_LINE)) {
			mapInstance.addLayer({
				id: SEARCH_RADIUS_LINE,
				type: 'line',
				source: SEARCH_RADIUS_SOURCE,
				paint: {
					'line-color': '#3b82f6',
					'line-opacity': 0.4,
					'line-width': 1.5
				}
			});
		}
	}

	function setSearchRadiusData(data: { type: 'FeatureCollection'; features: unknown[] }) {
		if (!mapInstance) return;
		ensureSearchRadiusLayers();
		const source = mapInstance.getSource(SEARCH_RADIUS_SOURCE);
		if (source && typeof source.setData === 'function') {
			source.setData(data);
		}
	}

	function getStatusColorCode(status: string): string {
		switch (status) {
			case 'OPEN':
				return '#22c55e'; // green
			case 'FULL':
				return '#ef4444'; // red
			case 'PREPARE':
				return '#f59e0b'; // amber
			case 'CLOSED':
				return '#94a3b8'; // slate
			default:
				return '#94a3b8'; // slate
		}
	}

	function getStatusText(status: string): string {
		switch (status) {
			case 'OPEN':
				return t.statusOpen;
			case 'FULL':
				return t.statusFull;
			case 'PREPARE':
				return t.statusStandby;
			case 'CLOSED':
				return t.statusClosed;
			default:
				return t.statusClosed;
		}
	}

	function getTypeIcon(siteKind: PublicSiteKind | undefined): string {
		return siteKind === 'host_house' ? '🏠' : '⛺';
	}

	function getSiteKindText(siteKind: PublicSiteKind | undefined): string {
		return siteKind === 'host_house' ? 'บ้านพี่เลี้ยง' : 'ศูนย์อพยพ';
	}

	onMount(async () => {
		const maplibre = await import('maplibre-gl');
		L = maplibre.default;

		mapInstance = new L.Map({
			container: mapElement,
			style: DEFAULT_MAP_STYLE,
			center,
			zoom
		});

		// Add zoom and rotation controls to the map.
		mapInstance.addControl(new L.NavigationControl(), 'bottom-right');

		const updateLabelsVisibility = () => {
			if (mapInstance && mapElement) {
				if (mapInstance.getZoom() >= 12) {
					mapElement.classList.add('show-labels');
				} else {
					mapElement.classList.remove('show-labels');
				}
			}
		};

		mapInstance.on('zoom', updateLabelsVisibility);

		mapInstance.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
			if (!placingPin) return;
			const { lat, lng } = e.lngLat;
			placingPin = false;
			onLocationPick?.(lat, lng);
		});

		mapInstance.on('load', () => {
			mapLoaded = true;
			updateLabelsVisibility(); // Initial check
		});
	});

	onDestroy(() => {
		if (mapInstance) {
			mapInstance.remove();
			mapInstance = null;
		}
	});

	$effect(() => {
		if (!mapElement) return;
		mapElement.style.cursor = placingPin ? 'crosshair' : '';
	});

	// Search-radius circle — separate from markers so radius changes skip fitBounds/marker rebuild.
	$effect(() => {
		if (!mapLoaded || !mapInstance) return;

		const rawLat = userLocation?.lat;
		const rawLng = userLocation?.lng;
		const uLat = rawLat != null && rawLat !== '' ? Number(rawLat) : NaN;
		const uLng = rawLng != null && rawLng !== '' ? Number(rawLng) : NaN;
		const radius =
			typeof radiusKm === 'number' && Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : NaN;

		if (!Number.isFinite(uLat) || !Number.isFinite(uLng) || !Number.isFinite(radius)) {
			setSearchRadiusData(EMPTY_FEATURE_COLLECTION);
			return;
		}

		setSearchRadiusData(circlePolygon(uLng, uLat, radius));
	});

	$effect(() => {
		if (!mapLoaded || !L || !mapInstance) return;
		// Re-render popups when master-data labels arrive.
		void shelterTypeLabels.data;

		// Clear old markers
		markersLayer.forEach((marker) => marker.remove());
		markersLayer = [];

		const bounds = new L.LngLatBounds();
		let hasMarkers = false;

		// 1. Draw User Location if available
		if (userLocation?.lat && userLocation?.lng) {
			const uLat = Number(userLocation.lat);
			const uLng = Number(userLocation.lng);
			if (!isNaN(uLat) && !isNaN(uLng)) {
				hasMarkers = true;
				bounds.extend([uLng, uLat]);

				const userEl = document.createElement('div');
				userEl.className = 'custom-user-marker';
				userEl.innerHTML = `
					<div style="width: 16px; height: 16px; border-radius: 50%; background: #3b82f6; border: 3px solid white; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3), 0 2px 6px rgba(0,0,0,0.4); cursor: pointer;"></div>
				`;

				const userPopup = new L.Popup({ offset: 12, closeButton: false }).setHTML(`
					<div style="font-size:0.75rem;font-family:sans-serif;color:#1e293b;text-align:center;font-weight:bold;">
						${t.yourLocation}
					</div>
				`);

				const userMarker = new L.Marker({ element: userEl, anchor: 'center' })
					.setLngLat([uLng, uLat])
					.setPopup(userPopup)
					.addTo(mapInstance);

				markersLayer.push(userMarker);
			}
		}

		// 2. Draw Shelters
		if (shelters && shelters.length > 0) {
			shelters.forEach((shelter) => {
				if (!shelter.geo || shelter.geo.lng == null || shelter.geo.lat == null) return;

				const lng = Number(shelter.geo.lng);
				const lat = Number(shelter.geo.lat);

				if (isNaN(lng) || isNaN(lat)) return;

				hasMarkers = true;
				const lngLat: [number, number] = [lng, lat];
				bounds.extend(lngLat);

				const color = getStatusColorCode(shelter.status);
				const icon = getTypeIcon(shelter.site_kind);

				const el = document.createElement('div');
				// Do not apply position: relative to the root element,
				// as it overrides MapLibre's .maplibregl-marker class (which uses position: absolute).
				el.className = 'custom-shelter-marker';
				el.innerHTML = `
					<div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 24px; height: 24px;">
						<div class="marker-dot" style="width:24px;height:24px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;transition: transform 0.2s;"></div>
						<!-- Pin pointer triangle to anchor to exact location -->
						<div style="position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid white;"></div>
						<div class="marker-label" style="position: absolute; top: 28px; white-space: nowrap; font-size: 0.625rem; font-weight: bold; background: white; padding: 2px 6px; border-radius: 4px; border: 1px solid #e2e8f0; color: #1e293b; pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
							${icon} ${shelter.name}
						</div>
					</div>
				`;

				// Add hover effect to the inner dot, not the root element
				const dot = el.querySelector('.marker-dot') as HTMLElement;
				el.onmouseenter = () => {
					if (dot) dot.style.transform = 'scale(1.3)';
				};
				el.onmouseleave = () => {
					if (dot) dot.style.transform = 'scale(1)';
				};

				const popup = new L.Popup({ offset: 12, closeButton: false }).setHTML(`
					<div style="font-size:12px;font-family:sans-serif;color:#1e293b;min-width:160px;">
						<strong style="font-size:14px;display:block;margin-bottom:4px;">${icon} ${shelter.name}</strong>
						<div style="margin-bottom:2px;font-size:11px;color:#64748b;">${getSiteKindText(shelter.site_kind)}</div>
						สถานะ: <strong style="color:${color};">${getStatusText(shelter.status)}</strong><br/>
						ความจุ: <strong>${shelter.capacity}</strong> คน<br/>
						${shelter.distance > 0 ? `ระยะทาง: <strong>${shelter.distance}</strong> กม.` : ''}
					</div>
				`);

				const marker = new L.Marker({ element: el }) // Default anchor is 'center', which is perfect for the 18x18 wrapper
					.setLngLat(lngLat)
					.setPopup(popup)
					.addTo(mapInstance);

				markersLayer.push(marker);
			});
		}

		if (hasMarkers) {
			const markerCount = markersLayer.length;
			if (markerCount === 1) {
				// We already have bounds, just use bounds with maxZoom
				mapInstance.fitBounds(bounds, { padding: 50, maxZoom: 14 });
			} else {
				mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 14 });
			}
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="/maplibre-gl.css" />
</svelte:head>

<div bind:this={mapElement} class="absolute inset-0 z-0 h-full w-full"></div>

{#if onLocationPick}
	<div class="absolute top-3 left-3 z-10 flex max-w-[min(100%-1.5rem,16rem)] flex-col gap-1.5">
		<Button
			type="button"
			size="sm"
			variant={placingPin ? 'default' : 'secondary'}
			class="rounded-xl border border-border bg-card/95 text-xs font-bold shadow-md backdrop-blur-md"
			onclick={() => (placingPin = !placingPin)}
		>
			<MapPin class="mr-1.5 h-3.5 w-3.5" />
			{placingPin ? t.cancelPlacePin : t.placePin}
		</Button>
		{#if placingPin}
			<p
				class="rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-2xs font-medium text-muted-foreground shadow-sm backdrop-blur-md"
			>
				{t.placingPin}
			</p>
		{/if}
	</div>
{/if}

<!-- Legend overlay -->
<div
	class="absolute bottom-8 left-2 z-10 rounded-xl border border-border bg-card/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur-md"
>
	<div class="mb-2 font-bold text-foreground">{t.shelterStatus}</div>
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white bg-[#22c55e] shadow-sm"></div>
			<span class="font-medium text-muted-foreground">{t.statusOpen}</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white bg-[#f59e0b] shadow-sm"></div>
			<span class="font-medium text-muted-foreground">{t.statusStandby}</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white bg-[#ef4444] shadow-sm"></div>
			<span class="font-medium text-muted-foreground">{t.statusFull}</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white bg-[#94a3b8] shadow-sm"></div>
			<span class="font-medium text-muted-foreground">{t.statusClosed}</span>
		</div>
	</div>
</div>

<style>
	:global(.marker-label) {
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.2s ease-in-out,
			visibility 0.2s ease-in-out;
	}
	:global(.show-labels .marker-label) {
		opacity: 1;
		visibility: visible;
	}
</style>
