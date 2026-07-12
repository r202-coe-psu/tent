<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import type {
		Map as MapLibreMap,
		Marker as MapLibreMarker,
		NavigationControl,
		MapMouseEvent
	} from 'maplibre-gl';

	// The dynamic import's `.default` is the UMD-style namespace object (Map,
	// Marker, NavigationControl, …) that Vite's dep pre-bundling synthesizes —
	// not the same shape as the named-exports module type, so we only type the
	// handful of members this component actually uses.
	type MapLibreNamespace = {
		Map: typeof MapLibreMap;
		Marker: typeof MapLibreMarker;
		NavigationControl: typeof NavigationControl;
	};

	let {
		lat = null,
		lng = null,
		disabled = false,
		center = [100.473531, 7.009425] as [number, number],
		zoom = 12,
		onchange
	}: {
		lat?: number | null;
		lng?: number | null;
		disabled?: boolean;
		center?: [number, number];
		zoom?: number;
		onchange: (lat: number | null, lng: number | null) => void;
	} = $props();

	let mapElement: HTMLElement;
	let mapInstance: MapLibreMap | null = null;
	let marker: MapLibreMarker | null = null;
	let L: MapLibreNamespace | null = null;
	let mapLoaded = $state(false);
	let destroyed = false;

	function setMarker(lngLat: [number, number]) {
		if (!L || !mapInstance) return;
		if (marker) {
			marker.setLngLat(lngLat);
			return;
		}
		const el = document.createElement('div');
		el.innerHTML = `
			<div style="position: relative; width: 28px; height: 40px; cursor: grab;">
				<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
					<path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26c0-7.7-6.3-14-14-14z" fill="#ef4444"/>
					<circle cx="14" cy="14" r="5.5" fill="white"/>
				</svg>
			</div>
		`;
		const newMarker = new L.Marker({ element: el, draggable: !disabled, anchor: 'bottom' })
			.setLngLat(lngLat)
			.addTo(mapInstance);

		newMarker.on('dragend', () => {
			const { lng: newLng, lat: newLat } = newMarker.getLngLat();
			onchange(Number(newLat.toFixed(6)), Number(newLng.toFixed(6)));
		});

		marker = newMarker;
	}

	function removeMarker() {
		if (marker) {
			marker.remove();
			marker = null;
		}
	}

	onMount(async () => {
		const maplibre = await import('maplibre-gl');
		if (destroyed) return;
		L = maplibre.default as unknown as MapLibreNamespace;

		const initialCenter: [number, number] =
			lat != null && lng != null ? [Number(lng), Number(lat)] : center;

		mapInstance = new L.Map({
			container: mapElement,
			style: {
				version: 8,
				sources: {
					osm: {
						type: 'raster',
						tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
						tileSize: 256,
						attribution: '&copy; OpenStreetMap contributors'
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
			center: initialCenter,
			zoom: lat != null && lng != null ? 16 : zoom
		});

		mapInstance.addControl(new L.NavigationControl({ showCompass: false }), 'top-right');

		mapInstance.on('load', () => {
			mapLoaded = true;
			if (lat != null && lng != null) {
				setMarker([Number(lng), Number(lat)]);
			}
		});

		mapInstance.on('click', (e: MapMouseEvent) => {
			if (disabled) return;
			const { lng: clickLng, lat: clickLat } = e.lngLat;
			setMarker([clickLng, clickLat]);
			onchange(Number(clickLat.toFixed(6)), Number(clickLng.toFixed(6)));
		});
	});

	onDestroy(() => {
		destroyed = true;
		if (mapInstance) {
			mapInstance.remove();
			mapInstance = null;
		}
	});

	// Keep the marker in sync if lat/lng change from outside (e.g. form reset).
	$effect(() => {
		if (!mapLoaded || !L || !mapInstance) return;
		if (lat == null || lng == null) {
			removeMarker();
			return;
		}
		const current = marker?.getLngLat();
		if (!current || current.lat !== lat || current.lng !== lng) {
			setMarker([Number(lng), Number(lat)]);
		}
	});

	function clearLocation() {
		removeMarker();
		onchange(null, null);
	}
</script>

<svelte:head>
	<link rel="stylesheet" href="/maplibre-gl.css" />
</svelte:head>

<div class="space-y-2">
	<div class="relative h-[480px] w-full overflow-hidden rounded-lg border border-input">
		<div bind:this={mapElement} class="absolute inset-0 h-full w-full"></div>
	</div>
	<div class="flex items-center justify-between text-xs text-muted-foreground">
		<span>
			{#if lat != null && lng != null}
				พิกัด: {lat.toFixed(6)}, {lng.toFixed(6)}
			{:else}
				แตะบนแผนที่เพื่อปักหมุดตำแหน่งศูนย์พักพิง (ลากหมุดเพื่อปรับตำแหน่ง)
			{/if}
		</span>
		{#if lat != null && lng != null && !disabled}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="h-6 px-2 text-xs"
				onclick={clearLocation}
			>
				<X class="mr-1 h-3 w-3" />
				ล้างตำแหน่ง
			</Button>
		{/if}
	</div>
</div>
