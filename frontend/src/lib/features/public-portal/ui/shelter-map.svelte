<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type {
		Map as MapLibreMap,
		Marker as MapLibreMarker,
		Popup as MapLibrePopup,
		NavigationControl,
		GeoJSONSource,
		LngLatBounds as MapLibreLngLatBounds
	} from 'maplibre-gl';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { PublicSiteKind } from '../domain/types';
	import { resolveMasterLabel } from '../domain/master-labels';
	import { useShelterTypeLabelMap } from '../application/queries';
	import { DEFAULT_MAP_STYLE, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '$lib/constants/maps';
	import { Button } from '$lib/components/ui/button';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_MAP_I18N } from '$lib/constants/i18n';

	type MapLibreNamespace = {
		Map: typeof MapLibreMap;
		Marker: typeof MapLibreMarker;
		Popup: typeof MapLibrePopup;
		NavigationControl: typeof NavigationControl;
		LngLatBounds: typeof MapLibreLngLatBounds;
	};

	interface ShelterGeo {
		lat: number;
		lng: number;
	}

	interface Shelter {
		id: string;
		code?: string;
		name: string;
		status: string;
		capacity: number;
		distance: number;
		site_kind?: PublicSiteKind;
		type?: string;
		admin_type?: string | null;
		geo?: ShelterGeo | null;
	}

	type ShelterMarkerItem = {
		marker: MapLibreMarker;
		popup: MapLibrePopup;
		el: HTMLElement;
		shelter: Shelter;
		lng: number;
		lat: number;
	};

	let {
		shelters = [],
		userLocation,
		radiusKm,
		center = DEFAULT_MAP_CENTER,
		zoom = DEFAULT_MAP_ZOOM,
		selectedId = null,
		onSelectShelter,
		onLocationPick
	}: {
		shelters?: Shelter[];
		userLocation?: { lat?: number | string; lng?: number | string };
		/** Search radius in km; when set with a valid origin, draws a subtle circle. */
		radiusKm?: number;
		center?: [number, number];
		zoom?: number;
		/** Currently selected shelter ID to sync with list */
		selectedId?: string | null;
		/** Callback when user clicks a shelter pin */
		onSelectShelter?: (shelterId: string) => void;
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
	let mapInstance: MapLibreMap | null = null;
	let markersLayer: MapLibreMarker[] = [];
	let shelterMarkerMap = new SvelteMap<string, ShelterMarkerItem>();
	let L: MapLibreNamespace | null = null;
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
		const source = mapInstance.getSource(SEARCH_RADIUS_SOURCE) as GeoJSONSource | undefined;
		if (source && typeof source.setData === 'function') {
			source.setData(data as never);
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
		return siteKind === 'host_house' ? t.hostHouse : t.evacCenter;
	}

	function translateAdminType(type: string): string {
		const legacyEn: Record<string, string> =
			langState.current === 'en'
				? {
						วัด: 'Temple',
						โรงเรียน: 'School',
						ศาลาประชาคม: 'Community Hall',
						ศูนย์กีฬา: 'Sports Centre',
						อาคารราชการ: 'Government Building',
						หน่วยงานราชการ: 'Government Agency',
						ศูนย์อพยพ: 'Evacuation Center',
						มหาวิทยาลัย: 'University',
						มัสยิด: 'Mosque',
						โบสถ์: 'Church',
						พื้นที่เอกชน: 'Private Area',
						อื่นๆ: 'Other',
						unspecified: 'Unspecified'
					}
				: { unspecified: '' };
		return resolveMasterLabel(type, shelterTypeLabels.data, legacyEn);
	}

	onMount(async () => {
		const maplibre = await import('maplibre-gl');
		const namespace = maplibre.default as unknown as MapLibreNamespace;
		L = namespace;

		const map = new namespace.Map({
			container: mapElement,
			style: DEFAULT_MAP_STYLE,
			center,
			zoom
		});
		mapInstance = map;

		// Add zoom and rotation controls to the map.
		map.addControl(new namespace.NavigationControl(), 'bottom-right');

		const updateLabelsVisibility = () => {
			if (map && mapElement) {
				if (map.getZoom() >= 12) {
					mapElement.classList.add('show-labels');
				} else {
					mapElement.classList.remove('show-labels');
				}
			}
		};

		map.on('zoom', updateLabelsVisibility);

		map.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
			if (!placingPin) return;
			const { lat, lng } = e.lngLat;
			placingPin = false;
			onLocationPick?.(lat, lng);
		});

		map.on('load', () => {
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
		// When placement mode turns on, switch cursor to crosshair; revert on off.
		if (mapElement) {
			mapElement.style.cursor = placingPin ? 'crosshair' : '';
		}
	});

	$effect(() => {
		if (!mapLoaded || !mapInstance) return;

		const uLat = Number(userLocation?.lat);
		const uLng = Number(userLocation?.lng);
		const radius = Number(radiusKm);

		if (!Number.isFinite(uLat) || !Number.isFinite(uLng) || !Number.isFinite(radius)) {
			setSearchRadiusData(EMPTY_FEATURE_COLLECTION);
			return;
		}

		setSearchRadiusData(circlePolygon(uLng, uLat, radius));
	});

	$effect(() => {
		if (!mapLoaded || !L || !mapInstance) return;
		const lib = L;
		const map = mapInstance;

		// Re-render popups when master-data labels arrive.
		void shelterTypeLabels.data;

		// Clear old markers
		markersLayer.forEach((marker) => marker.remove());
		markersLayer = [];
		shelterMarkerMap.clear();

		const bounds = new lib.LngLatBounds();
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

				const userPopup = new lib.Popup({ offset: 12, closeButton: false }).setHTML(`
					<div style="font-size:0.75rem;font-family:sans-serif;color:#1e293b;text-align:center;font-weight:bold;">
						${t.yourLocation}
					</div>
				`);

				const userMarker = new lib.Marker({ element: userEl, anchor: 'center' })
					.setLngLat([uLng, uLat])
					.setPopup(userPopup)
					.addTo(map);

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
				const shelterId = shelter.id || shelter.code || '';
				const shelterCode = shelter.code || shelter.id || '';
				const canBook = Boolean(shelterCode) && shelter.status !== 'CLOSED';

				const el = document.createElement('div');
				// Do not apply position: relative to the root element,
				// as it overrides MapLibre's .maplibregl-marker class (which uses position: absolute).
				el.className = 'custom-shelter-marker';
				if (shelterId === selectedId || (shelter.code && shelter.code === selectedId)) {
					el.classList.add('is-selected');
				}
				el.innerHTML = `
					<div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 24px; height: 24px;">
						<div class="marker-dot" style="width:24px;height:24px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;transition: transform 0.2s, box-shadow 0.2s;"></div>
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
					if (dot && !el.classList.contains('is-selected')) dot.style.transform = 'scale(1.25)';
				};
				el.onmouseleave = () => {
					if (dot && !el.classList.contains('is-selected')) dot.style.transform = 'scale(1)';
				};

				el.addEventListener('click', (ev) => {
					ev.stopPropagation();
					if (shelterId) {
						onSelectShelter?.(shelterId);
					}
				});

				const bookingButtonHtml = canBook
					? `<a href="/pre-register?shelter=${encodeURIComponent(shelterCode)}"
						style="display:flex;align-items:center;justify-content:center;gap:6px;background:#2563eb;color:#ffffff;padding:6px 12px;border-radius:8px;font-weight:bold;font-size:0.75rem;text-decoration:none;margin-top:8px;box-shadow:0 1px 3px rgba(37,99,235,0.3);">
						<span>📋</span> ${t.preRegister}
					</a>`
					: `<div style="margin-top:8px;text-align:center;font-size:0.7rem;color:#94a3b8;font-weight:600;padding:4px 8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
						${t.shelterClosed}
					</div>`;

				const detailsButtonHtml = `
					<a href="/shelters/${shelterId}"
						style="display:flex;align-items:center;justify-content:center;gap:6px;background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;padding:5px 12px;border-radius:8px;font-weight:600;font-size:0.7rem;text-decoration:none;margin-top:4px;">
						<span>👁️</span> ${t.viewDetails}
					</a>
				`;

				const popup = new lib.Popup({ offset: 12, closeButton: true, maxWidth: '240px' }).setHTML(`
					<div style="font-size:0.75rem;font-family:sans-serif;color:#1e293b;min-width:170px;padding:2px 0;">
						<strong style="font-size:0.875rem;display:block;margin-bottom:3px;color:#0f172a;">${icon} ${shelter.name}</strong>
						<div style="margin-bottom:4px;font-size:0.625rem;color:#64748b;">${getSiteKindText(shelter.site_kind)} · ${shelter.type || shelter.admin_type ? translateAdminType(shelter.type || shelter.admin_type || '') : t.shelter}</div>
						<div style="line-height:1.45;color:#334155;">
							${t.status} <strong style="color:${color};">${getStatusText(shelter.status)}</strong><br/>
							${t.capacity} <strong>${shelter.capacity}</strong> ${t.people}<br/>
							${shelter.distance > 0 ? `${t.distance} <strong>${shelter.distance}</strong> ${t.km}` : ''}
						</div>
						${bookingButtonHtml}
						${detailsButtonHtml}
					</div>
				`);

				const marker = new lib.Marker({ element: el }) // Default anchor is 'center', which is perfect for the 18x18 wrapper
					.setLngLat(lngLat)
					.setPopup(popup)
					.addTo(map);

				markersLayer.push(marker);
				if (shelterId) {
					shelterMarkerMap.set(shelterId, {
						marker,
						popup,
						el,
						shelter,
						lng,
						lat
					});
				}
			});
		}

		if (hasMarkers) {
			const markerCount = markersLayer.length;
			if (markerCount === 1) {
				const centerLngLat = bounds.getCenter();
				map.easeTo({ center: [centerLngLat.lng, centerLngLat.lat], zoom: 15 });
			} else {
				map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
			}
		}
	});

	// React to selection change from outside or user action
	$effect(() => {
		if (!mapLoaded || !mapInstance) return;
		const currentSelected = selectedId;

		shelterMarkerMap.forEach((item, id) => {
			const isMatch = Boolean(
				currentSelected &&
				(id === currentSelected || (item.shelter.code && item.shelter.code === currentSelected))
			);
			if (isMatch) {
				item.el.classList.add('is-selected');
				if (!item.popup.isOpen()) {
					item.popup.addTo(mapInstance!);
				}
				mapInstance!.easeTo({
					center: [item.lng, item.lat],
					zoom: Math.max(mapInstance!.getZoom(), 15),
					duration: 500
				});
			} else {
				item.el.classList.remove('is-selected');
			}
		});
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
	:global(.custom-shelter-marker.is-selected) {
		z-index: 50 !important;
	}
	:global(.custom-shelter-marker.is-selected .marker-dot) {
		transform: scale(1.35) !important;
		box-shadow:
			0 0 0 4px rgba(37, 99, 235, 0.45),
			0 4px 10px rgba(0, 0, 0, 0.4) !important;
	}
	:global(.custom-shelter-marker.is-selected .marker-label) {
		opacity: 1 !important;
		visibility: visible !important;
		background: #0f172a !important;
		color: #ffffff !important;
		border-color: #334155 !important;
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3) !important;
	}
</style>
