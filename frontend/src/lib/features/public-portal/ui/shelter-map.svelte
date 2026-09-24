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
	import { resolveMasterLabel, toLabelMap } from '../domain/master-labels';
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
		accepts_pre_registration?: boolean;
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
		disablePopup = false,
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
		/** When true (e.g. mobile view), marker click only triggers selection without showing map popup */
		disablePopup?: boolean;
		/** Callback when user clicks a shelter pin */
		onSelectShelter?: (shelterId: string) => void;
		/** Called when the user places a search-origin pin on the map. */
		onLocationPick?: (lat: number, lng: number) => void;
	} = $props();

	const shelterTypeLabelsQuery = useShelterTypeLabelMap();
	const shelterTypeLabels = $derived(toLabelMap(shelterTypeLabelsQuery.data, langState.current));

	const SEARCH_RADIUS_SOURCE = 'search-radius';
	const SEARCH_RADIUS_FILL = 'search-radius-fill';
	const SEARCH_RADIUS_LINE = 'search-radius-line';
	/** Civic Design System — Cerulean (location / selection accent) */
	const CERULEAN = '#0284C7';
	const EMPTY_FEATURE_COLLECTION = {
		type: 'FeatureCollection' as const,
		features: [] as never[]
	};

	let mapElement: HTMLElement;
	let mapInstance: MapLibreMap | null = null;
	let activePopup: MapLibrePopup | null = null;
	let markersLayer: MapLibreMarker[] = [];
	let shelterMarkerMap = new SvelteMap<string, ShelterMarkerItem>();
	let L: MapLibreNamespace | null = null;
	let mapLoaded = $state(false);
	let placingPin = $state(false);
	let lastCenteredUser: string | null = null;

	function closeActivePopup() {
		if (activePopup) {
			activePopup.remove();
			activePopup = null;
		}
	}

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
					'fill-color': CERULEAN,
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
					'line-color': CERULEAN,
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
				return '#16A34A'; // Civic success
			case 'FULL':
				return '#DC2626'; // Civic danger
			case 'PREPARE':
				return '#F59E0B'; // Civic warning
			case 'CLOSED':
				return '#94A3B8'; // Civic muted
			default:
				return '#94A3B8';
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

	function getSiteKindText(siteKind: PublicSiteKind | undefined): string {
		return siteKind === 'host_house' ? t.hostHouse : t.evacCenter;
	}

	/** Classic teardrop pin — building/tent glyph in the head. Tip at bottom. */
	function evacCenterPinSvg(fill: string): string {
		return `<svg class="marker-pin" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 2px rgba(15,23,42,0.12));cursor:pointer;transition:transform 0.2s,filter 0.2s;">
			<path d="M15 1.5C8.1 1.5 2.5 7.1 2.5 14c0 8.2 10.2 22.8 12.1 25.2a0.6 0.6 0 0 0 0.8 0C17.3 36.8 27.5 22.2 27.5 14 27.5 7.1 21.9 1.5 15 1.5z" fill="${fill}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
			<path d="M10.5 18.5V12.5h9v6" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M9.5 12.8L15 8.5l5.5 4.3" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M13.2 18.5v-3h3.6v3" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>`;
	}

	/** House silhouette pin — door/window glyph. Tip points to lat/lng. */
	function hostHousePinSvg(fill: string): string {
		return `<svg class="marker-pin" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 2px rgba(15,23,42,0.12));cursor:pointer;transition:transform 0.2s,filter 0.2s;">
			<path d="M15 1.5L3.5 11.2v11.3c0 1.3 1.1 2.3 2.3 2.3h18.4c1.2 0 2.3-1 2.3-2.3V11.2L15 1.5z" fill="${fill}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
			<path d="M15 24.8L11.5 35.5c-0.4 1.15 0.75 2.15 1.7 1.4L15 34.8l1.8 2.1c0.95 0.75 2.1-0.25 1.7-1.4L15 24.8z" fill="${fill}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
			<rect x="13.1" y="14.8" width="3.8" height="7" rx="0.6" fill="none" stroke="#ffffff" stroke-width="1.4"/>
			<rect x="7.8" y="12.8" width="3.4" height="3.4" rx="0.4" fill="none" stroke="#ffffff" stroke-width="1.3"/>
			<rect x="18.8" y="12.8" width="3.4" height="3.4" rx="0.4" fill="none" stroke="#ffffff" stroke-width="1.3"/>
		</svg>`;
	}

	function getShelterPinSvg(siteKind: PublicSiteKind | undefined, fill: string): string {
		return siteKind === 'host_house' ? hostHousePinSvg(fill) : evacCenterPinSvg(fill);
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
		return resolveMasterLabel(type, shelterTypeLabels, legacyEn);
	}

	onMount(async () => {
		const maplibre = await import('maplibre-gl');
		const namespace = maplibre.default as unknown as MapLibreNamespace;
		L = namespace;

		const uLatNum = Number(userLocation?.lat);
		const uLngNum = Number(userLocation?.lng);
		const initialCenter: [number, number] =
			!isNaN(uLatNum) && !isNaN(uLngNum) && uLatNum !== 0 && uLngNum !== 0
				? [uLngNum, uLatNum]
				: center;

		const map = new namespace.Map({
			container: mapElement,
			style: DEFAULT_MAP_STYLE,
			center: initialCenter,
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

		if (typeof ResizeObserver !== 'undefined' && mapElement) {
			ro = new ResizeObserver(() => {
				map.resize();
			});
			ro.observe(mapElement);
		}
	});

	let ro: ResizeObserver | null = null;

	onDestroy(() => {
		if (ro) {
			ro.disconnect();
			ro = null;
		}
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
		void shelterTypeLabelsQuery.data;
		void shelterTypeLabels;

		closeActivePopup();
		// Clear old markers
		markersLayer.forEach((marker) => {
			marker.getPopup()?.remove();
			marker.remove();
		});
		markersLayer = [];
		shelterMarkerMap.clear();

		const bounds = new lib.LngLatBounds();
		let hasMarkers = false;
		let hasUserLocation = false;
		let userLngCoord = 0;
		let userLatCoord = 0;

		// 1. Draw User Location if available
		if (userLocation?.lat && userLocation?.lng) {
			const uLat = Number(userLocation.lat);
			const uLng = Number(userLocation.lng);
			if (!isNaN(uLat) && !isNaN(uLng)) {
				hasMarkers = true;
				hasUserLocation = true;
				userLatCoord = uLat;
				userLngCoord = uLng;
				bounds.extend([uLng, uLat]);

				const userEl = document.createElement('div');
				userEl.className = 'custom-user-marker';
				userEl.innerHTML = `
					<div class="user-marker-dot" style="position:relative;width:16px;height:16px;">
						<span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${CERULEAN};opacity:0.35;animation:user-marker-pulse 1.8s ease-out infinite;"></span>
						<span style="position:absolute;inset:0;border-radius:50%;background:${CERULEAN};border:3px solid white;box-shadow:0 1px 2px rgba(15,23,42,0.12);cursor:pointer;"></span>
					</div>
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
				const pinSvg = getShelterPinSvg(shelter.site_kind, color);
				const shelterId = shelter.id || shelter.code || '';
				const shelterCode = shelter.code || shelter.id || '';
				const canBook =
					Boolean(shelterCode) &&
					shelter.status !== 'CLOSED' &&
					shelter.accepts_pre_registration === true;

				const el = document.createElement('div');
				// Do not apply position: relative to the root element,
				// as it overrides MapLibre's .maplibregl-marker class (which uses position: absolute).
				el.className = 'custom-shelter-marker';
				el.innerHTML = `
					<div style="position:relative;display:flex;flex-direction:column;align-items:center;width:30px;">
						${pinSvg}
						<div class="marker-label" style="position:absolute;top:42px;white-space:nowrap;font-size:0.625rem;font-weight:bold;background:white;padding:2px 6px;border-radius:4px;border:1px solid #e2e8f0;color:#1e293b;pointer-events:none;box-shadow:0 1px 2px rgba(15,23,42,0.08);">
							${shelter.name}
						</div>
					</div>
				`;

				const pin = el.querySelector('.marker-pin') as HTMLElement | null;
				el.onmouseenter = () => {
					if (pin && !el.classList.contains('is-selected')) pin.style.transform = 'scale(1.12)';
				};
				el.onmouseleave = () => {
					if (pin && !el.classList.contains('is-selected')) pin.style.transform = 'scale(1)';
				};

				el.addEventListener('click', (ev) => {
					ev.stopPropagation();
					const idToSelect = shelter.id || shelter.code;
					if (idToSelect) {
						onSelectShelter?.(idToSelect);
					}
				});

				const bookingButtonHtml = canBook
					? `<a href="/pre-register?shelter=${encodeURIComponent(shelterCode)}"
						style="display:flex;align-items:center;justify-content:center;gap:6px;background:${CERULEAN};color:#ffffff;padding:6px 12px;border-radius:8px;font-weight:bold;font-size:0.75rem;text-decoration:none;margin-top:8px;box-shadow:0 1px 2px rgba(2,132,199,0.25);">
						${t.preRegister}
					</a>`
					: `<div style="margin-top:8px;text-align:center;font-size:0.7rem;color:#94a3b8;font-weight:600;padding:4px 8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
						${t.shelterClosed}
					</div>`;

				const detailsButtonHtml = `
					<a href="/shelters/${shelterId}"
						style="display:flex;align-items:center;justify-content:center;gap:6px;background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;padding:5px 12px;border-radius:8px;font-weight:600;font-size:0.7rem;text-decoration:none;margin-top:4px;">
						${t.viewDetails}
					</a>
				`;

				const popup = new lib.Popup({
					offset: 16,
					closeButton: true,
					closeOnClick: false,
					maxWidth: '280px'
				}).setLngLat(lngLat).setHTML(`
					<div style="font-size:0.75rem;font-family:'IBM Plex Sans Thai',sans-serif;color:#1e293b;min-width:180px;padding:2px 0;">
						<strong style="font-size:0.875rem;display:block;margin-bottom:3px;color:#0f172a;line-height:1.3;">${shelter.name}</strong>
						<div style="margin-bottom:6px;font-size:0.65rem;color:#64748b;font-weight:500;">
							${getSiteKindText(shelter.site_kind)} · ${shelter.type || shelter.admin_type ? translateAdminType(shelter.type || shelter.admin_type || '') : t.shelter}
						</div>
						<div style="line-height:1.5;color:#334155;font-size:0.75rem;background:#f8fafc;padding:6px 8px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;">
							<div style="display:flex;justify-content:space-between;margin-bottom:2px;">
								<span>${t.status}</span>
								<strong style="color:${color};">${getStatusText(shelter.status)}</strong>
							</div>
							<div style="display:flex;justify-content:space-between;margin-bottom:2px;">
								<span>${t.capacity}</span>
								<strong>${shelter.capacity} ${t.people}</strong>
							</div>
							${
								shelter.distance > 0
									? `
							<div style="display:flex;justify-content:space-between;">
								<span>${t.distance}</span>
								<strong>${shelter.distance} ${t.km}</strong>
							</div>`
									: ''
							}
						</div>
						${bookingButtonHtml}
						${detailsButtonHtml}
					</div>
				`);

				popup.on('close', () => {
					if (activePopup === popup) {
						activePopup = null;
					}
					const currentId = shelter.id || shelter.code;
					if (
						selectedId === currentId ||
						selectedId === shelter.id ||
						selectedId === shelter.code
					) {
						onSelectShelter?.('');
					}
				});

				const marker = new lib.Marker({ element: el, anchor: 'bottom' }).setLngLat(lngLat);

				if (!disablePopup) {
					marker.setPopup(popup);
				}

				marker.addTo(map);

				markersLayer.push(marker);
				const markerItem: ShelterMarkerItem = {
					marker,
					popup,
					el,
					shelter,
					lng,
					lat
				};
				if (shelter.id) {
					shelterMarkerMap.set(shelter.id, markerItem);
				}
				if (shelter.code) {
					shelterMarkerMap.set(shelter.code, markerItem);
				}
			});
		}

		if (!selectedId) {
			if (hasUserLocation) {
				const userKey = `${userLngCoord.toFixed(5)},${userLatCoord.toFixed(5)}`;
				if (lastCenteredUser !== userKey) {
					lastCenteredUser = userKey;
					map.easeTo({
						center: [userLngCoord, userLatCoord],
						zoom: Math.max(map.getZoom(), zoom)
					});
				}
			} else if (hasMarkers) {
				const markerCount = markersLayer.length;
				if (markerCount === 1) {
					const centerLngLat = bounds.getCenter();
					map.easeTo({ center: [centerLngLat.lng, centerLngLat.lat], zoom: 15 });
				} else {
					map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
				}
			}
		}
	});

	// React to selection change from outside or user action
	$effect(() => {
		if (!mapLoaded || !mapInstance) return;
		const currentSelected = selectedId;

		if (!currentSelected) {
			closeActivePopup();
			shelterMarkerMap.forEach((item) => {
				item.el.classList.remove('is-selected');
			});
			return;
		}

		let matchedItem: ShelterMarkerItem | null = null;

		shelterMarkerMap.forEach((item, id) => {
			const isMatch = Boolean(
				id === currentSelected ||
				item.shelter.id === currentSelected ||
				(item.shelter.code && item.shelter.code === currentSelected)
			);
			if (isMatch) {
				matchedItem = item;
				item.el.classList.add('is-selected');
			} else {
				item.el.classList.remove('is-selected');
			}
		});

		if (matchedItem) {
			const target = matchedItem as ShelterMarkerItem;
			if (!disablePopup) {
				if (activePopup && activePopup !== target.popup) {
					activePopup.remove();
				}
				activePopup = target.popup;
				target.popup.setLngLat([target.lng, target.lat]).addTo(mapInstance!);
			} else {
				closeActivePopup();
			}
			mapInstance!.easeTo({
				center: [target.lng, target.lat],
				zoom: Math.max(mapInstance!.getZoom(), 15),
				duration: 400
			});
		} else {
			closeActivePopup();
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="/maplibre-gl.css" />
</svelte:head>

<div bind:this={mapElement} class="absolute inset-0 z-0 h-full w-full"></div>

{#if onLocationPick}
	<div
		class="pointer-events-auto absolute top-4 left-1/2 z-10 flex max-w-[min(100%-1.5rem,16rem)] -translate-x-1/2 flex-col items-center gap-1.5"
	>
		<Button
			type="button"
			size="sm"
			variant={placingPin ? 'default' : 'secondary'}
			class="rounded-full border border-border/80 bg-card/95 px-3.5 py-1.5 text-xs font-bold shadow-md backdrop-blur-md hover:bg-card"
			onclick={() => (placingPin = !placingPin)}
		>
			<MapPin class="mr-1.5 h-3.5 w-3.5 text-primary" />
			{placingPin ? t.cancelPlacePin : t.placePin}
		</Button>
		{#if placingPin}
			<p
				class="rounded-lg border border-border bg-card/95 px-2.5 py-1 text-2xs font-medium text-muted-foreground shadow-sm backdrop-blur-md"
			>
				{t.placingPin}
			</p>
		{/if}
	</div>
{/if}

<!-- Legend overlay -->
<div
	class="pointer-events-auto absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-4 rounded-full border border-border/80 bg-card/95 px-4 py-2 text-2xs font-medium shadow-md backdrop-blur-md sm:flex"
>
	<div class="flex items-center gap-2">
		<span class="font-bold text-foreground">{t.siteKindLabel}:</span>
		<div class="flex items-center gap-1.5">
			<svg
				width="14"
				height="18"
				viewBox="0 0 30 40"
				aria-hidden="true"
				class="shrink-0 drop-shadow-xs"
			>
				<path
					d="M15 1.5C8.1 1.5 2.5 7.1 2.5 14c0 8.2 10.2 22.8 12.1 25.2a0.6 0.6 0 0 0 0.8 0C17.3 36.8 27.5 22.2 27.5 14 27.5 7.1 21.9 1.5 15 1.5z"
					fill="none"
					stroke="currentColor"
					class="text-foreground"
					stroke-width="2.5"
					stroke-linejoin="round"
				/>
			</svg>
			<span class="text-muted-foreground">{t.evacCenter}</span>
		</div>
		<div class="flex items-center gap-1.5">
			<svg
				width="14"
				height="18"
				viewBox="0 0 30 40"
				aria-hidden="true"
				class="shrink-0 drop-shadow-xs"
			>
				<path
					d="M15 1.5L3.5 11.2v11.3c0 1.3 1.1 2.3 2.3 2.3h18.4c1.2 0 2.3-1 2.3-2.3V11.2L15 1.5z"
					fill="none"
					stroke="currentColor"
					class="text-foreground"
					stroke-width="2.5"
					stroke-linejoin="round"
				/>
				<path
					d="M15 24.8L11.5 35.5c-0.4 1.15 0.75 2.15 1.7 1.4L15 34.8l1.8 2.1c0.95 0.75 2.1-0.25 1.7-1.4L15 24.8z"
					fill="none"
					stroke="currentColor"
					class="text-foreground"
					stroke-width="2"
					stroke-linejoin="round"
				/>
			</svg>
			<span class="text-muted-foreground">{t.hostHouse}</span>
		</div>
	</div>
	<div class="h-4 w-px bg-border"></div>
	<div class="flex items-center gap-2">
		<span class="font-bold text-foreground">{t.shelterStatus}:</span>
		<div class="flex items-center gap-1.5">
			<div class="h-2.5 w-2.5 rounded-full border border-white bg-[#16A34A] shadow-xs"></div>
			<span class="text-muted-foreground">{t.statusOpen}</span>
		</div>
		<div class="flex items-center gap-1.5">
			<div class="h-2.5 w-2.5 rounded-full border border-white bg-[#F59E0B] shadow-xs"></div>
			<span class="text-muted-foreground">{t.statusStandby}</span>
		</div>
		<div class="flex items-center gap-1.5">
			<div class="h-2.5 w-2.5 rounded-full border border-white bg-[#DC2626] shadow-xs"></div>
			<span class="text-muted-foreground">{t.statusFull}</span>
		</div>
		<div class="flex items-center gap-1.5">
			<div class="h-2.5 w-2.5 rounded-full border border-white bg-[#94A3B8] shadow-xs"></div>
			<span class="text-muted-foreground">{t.statusClosed}</span>
		</div>
	</div>
</div>

<style>
	:global(.maplibregl-popup-content) {
		border-radius: 1rem !important;
		padding: 0.875rem 1rem !important;
		box-shadow:
			0 10px 25px -5px rgba(0, 0, 0, 0.12),
			0 8px 10px -6px rgba(0, 0, 0, 0.08) !important;
		border: 1px solid #e2e8f0 !important;
		font-family:
			'IBM Plex Sans Thai',
			-apple-system,
			sans-serif !important;
	}
	:global(.maplibregl-popup-close-button) {
		padding: 4px 8px !important;
		color: #64748b !important;
		font-size: 1.125rem !important;
		line-height: 1 !important;
		border-radius: 0.5rem !important;
	}
	:global(.maplibregl-popup-close-button:hover) {
		background-color: #f1f5f9 !important;
		color: #0f172a !important;
	}
	:global(.maplibregl-popup-tip) {
		border-top-color: #ffffff !important;
	}
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
	:global(.custom-shelter-marker.is-selected .marker-pin) {
		transform: scale(1.18) !important;
		filter: drop-shadow(0 0 2px #0284c7) drop-shadow(0 0 5px rgba(2, 132, 199, 0.55))
			drop-shadow(0 1px 2px rgba(15, 23, 42, 0.12)) !important;
	}
	:global(.custom-shelter-marker.is-selected .marker-label) {
		opacity: 1 !important;
		visibility: visible !important;
		background: #0f172a !important;
		color: #ffffff !important;
		border-color: #334155 !important;
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3) !important;
	}
	@keyframes -global-user-marker-pulse {
		0% {
			transform: scale(0.85);
			opacity: 0.45;
		}
		70% {
			transform: scale(1.35);
			opacity: 0;
		}
		100% {
			transform: scale(1.35);
			opacity: 0;
		}
	}
</style>
