<script lang="ts">
	/* eslint-disable @typescript-eslint/no-explicit-any */
	import { onMount, onDestroy } from 'svelte';

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
		type?: string;
		geo?: ShelterGeo | null;
	}

	let {
		shelters = [],
		userLocation,
		center = [100.473531, 7.009425] as [number, number],
		zoom = 11
	}: {
		shelters?: Shelter[];
		userLocation?: { lat?: number | string; lng?: number | string };
		center?: [number, number];
		zoom?: number;
	} = $props();

	let mapElement: HTMLElement;
	let mapInstance: any = null;
	let markersLayer: any[] = [];
	let L: any = null;
	let mapLoaded = $state(false);

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
				return 'เปิดใช้งาน';
			case 'FULL':
				return 'เต็มความจุ';
			case 'PREPARE':
				return 'เตรียมพร้อม';
			case 'CLOSED':
				return 'ปิดทำการ';
			default:
				return 'ปิดทำการ';
		}
	}

	function getTypeIcon(type: string | undefined): string {
		if (!type) return '🏠';
		if (type.includes('อพยพ')) return '⛺';
		if (type.includes('แพทย์') || type.includes('พยาบาล')) return '🏥';
		if (type.includes('วัด')) return '🛕';
		if (type.includes('โรงเรียน')) return '🏫';
		return '🏠';
	}

	onMount(async () => {
		const maplibre = await import('maplibre-gl');
		L = maplibre.default;

		mapInstance = new L.Map({
			container: mapElement,
			style: {
				version: 8,
				sources: {
					osm: {
						type: 'raster',
						tiles: ['https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png'],
						tileSize: 256,
						attribution:
							'&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a>'
					}
				},
				layers: [
					{
						id: 'osm',
						type: 'raster',
						source: 'osm',
						minzoom: 0,
						maxzoom: 19
					}
				]
			},
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
		if (!mapLoaded || !L || !mapInstance) return;

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
					<div style="font-size:12px;font-family:sans-serif;color:#1e293b;text-align:center;font-weight:bold;">
						📍 ตำแหน่งของคุณ
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
				const icon = getTypeIcon(shelter.type);

				const el = document.createElement('div');
				// Do not apply position: relative to the root element,
				// as it overrides MapLibre's .maplibregl-marker class (which uses position: absolute).
				el.className = 'custom-shelter-marker';
				el.innerHTML = `
					<div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 24px; height: 24px;">
						<div class="marker-dot" style="width:24px;height:24px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;transition: transform 0.2s;"></div>
						<!-- Pin pointer triangle to anchor to exact location -->
						<div style="position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid white;"></div>
						<div class="marker-label" style="position: absolute; top: 28px; white-space: nowrap; font-size: 11px; font-weight: bold; background: white; padding: 2px 6px; border-radius: 4px; border: 1px solid #e2e8f0; color: #1e293b; pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
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
						<div style="margin-bottom:2px;font-size:11px;color:#64748b;">${shelter.type || 'ศูนย์พักพิง'}</div>
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

<!-- Legend overlay -->
<div
	class="absolute bottom-8 left-2 z-10 rounded-xl border border-border/50 bg-black/70 px-3 py-2.5 text-xs shadow-lg backdrop-blur-md"
>
	<div class="mb-2 font-bold text-white">สถานะศูนย์พักพิง</div>
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white/80 bg-[#22c55e] shadow-sm"></div>
			<span class="font-medium text-slate-200">เปิดใช้งาน</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white/80 bg-[#f59e0b] shadow-sm"></div>
			<span class="font-medium text-slate-200">เตรียมพร้อม</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white/80 bg-[#ef4444] shadow-sm"></div>
			<span class="font-medium text-slate-200">เต็มความจุ</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="h-3 w-3 rounded-full border border-white/80 bg-[#94a3b8] shadow-sm"></div>
			<span class="font-medium text-slate-200">ปิดทำการ</span>
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
