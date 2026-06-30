<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	
	// Icons
	import Building2 from '@lucide/svelte/icons/building-2';
	import Users from '@lucide/svelte/icons/users';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Search from '@lucide/svelte/icons/search';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import MapIcon from '@lucide/svelte/icons/map';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Eye from '@lucide/svelte/icons/eye';
	import Filter from '@lucide/svelte/icons/filter';
	
	import { Button } from '$lib/components/ui/button';
	import PublicShelterMetricCard from '$lib/components/public-shelter-metric-card.svelte';
	import PublicShelterCard from '$lib/components/public-shelter-card.svelte';

	let { data }: { data: PageData } = $props();

	let initialSearch = data.filters.search;
	let initialOccupancy = data.flags.public_metrics_occupancy;
	let initialVulnerable = data.flags.public_metrics_vulnerable;

	let searchQuery = $state(initialSearch);
	
	// Toggles for demo
	let public_metrics_occupancy = $state(initialOccupancy);
	let public_metrics_vulnerable = $state(initialVulnerable);
	
	function getStatusColor(status: string) {
		switch (status) {
			case 'OPEN': return 'bg-success/20 text-success border-success/30';
			case 'FULL': return 'bg-danger/20 text-danger border-danger/30';
			case 'PREPARE': return 'bg-warning/20 text-warning border-warning/30';
			default: return 'bg-muted text-muted-foreground border-border';
		}
	}
	
	function getStatusText(status: string) {
		switch (status) {
			case 'OPEN': return 'เปิดใช้งาน';
			case 'FULL': return 'เต็มความจุ';
			case 'PREPARE': return 'เตรียมพร้อม';
			default: return 'ปิดทำการ';
		}
	}

	function getStatusColorCode(status: string) {
		switch (status) {
			case 'OPEN': return '#22c55e';
			case 'FULL': return '#ef4444';
			case 'PREPARE': return '#f59e0b';
			default: return '#94a3b8';
		}
	}

	let mapElement: HTMLElement;
	let mapInstance: any;
	let markersLayer: any[] = [];
	let L: any;

	onMount(async () => {
		if (browser) {
			L = (await import('maplibre-gl')).default;
			
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
					layers: [{
						id: 'osm',
						type: 'raster',
						source: 'osm',
						minzoom: 0,
						maxzoom: 19
					}]
				},
				center: [100.4735, 7.0094], // [lng, lat]
				zoom: 11
			});
		}
	});

	onDestroy(() => {
		if (mapInstance) {
			mapInstance.remove();
		}
	});

	$effect(() => {
		if (!L || !mapInstance || !data.shelters) return;
		
		// clear old markers
		markersLayer.forEach(marker => marker.remove());
		markersLayer = [];
		
		const bounds = new L.LngLatBounds();
		let hasMarkers = false;

		data.shelters.forEach((shelter: any) => {
			if (!shelter.geo || typeof shelter.geo.lng !== 'number' || typeof shelter.geo.lat !== 'number') return;
			hasMarkers = true;
			const lngLat = [shelter.geo.lng, shelter.geo.lat];
			bounds.extend(lngLat);

			const color = getStatusColorCode(shelter.status);
			
			const el = document.createElement('div');
			el.style.backgroundColor = color;
			el.style.width = '16px';
			el.style.height = '16px';
			el.style.borderRadius = '50%';
			el.style.border = '2px solid white';
			el.style.boxShadow = '0 0 4px rgba(0,0,0,0.4)';

			const popup = new L.Popup({ offset: 10 }).setHTML(`
				<div class="text-xs font-sans text-slate-800">
					<strong class="text-sm">${shelter.name}</strong><br/>
					สถานะ: <strong>${getStatusText(shelter.status)}</strong><br/>
					ผู้พักพิง: ${shelter.occupancy}/${shelter.capacity} คน<br/>
					ระยะทาง: ${shelter.distance} กม.
				</div>
			`);

			const marker = new L.Marker({ element: el })
				.setLngLat(lngLat)
				.setPopup(popup)
				.addTo(mapInstance);
				
			markersLayer.push(marker);
		});

		if (hasMarkers && mapInstance) {
			mapInstance.fitBounds(bounds, { padding: 30, maxZoom: 14 });
		}
	});
</script>

<svelte:head>
	<title>ตรวจสอบสถานะศูนย์พักพิง - Smart Shelter</title>
	<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<!-- Header / Hero Section -->
	<div class="mb-8 rounded-2xl bg-primary-dark p-8 text-primary-foreground shadow-lg lg:p-12 relative overflow-hidden">
		<!-- Background decorative elements -->
		<div class="absolute inset-0 opacity-10" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 24px 24px;"></div>
		<div class="relative z-10">
			<div class="mb-4 inline-flex items-center gap-2 rounded-lg bg-primary-foreground/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground/90 backdrop-blur-sm border border-primary-foreground/20">
				<Building2 class="h-4 w-4" />
				Public Shelter Dashboard
			</div>
			<h1 class="mb-4 text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
				ตรวจสอบสถานะศูนย์พักพิง
			</h1>
			<p class="max-w-2xl text-base text-primary-foreground/80 md:text-lg">
				ข้อมูลรวมศูนย์พักพิง สถานะความจุ และเปอร์เซ็นต์ความหนาแน่นของผู้ประสบภัยตามเวลาจริง เพื่อประกอบการตัดสินใจเคลื่อนย้ายและขอรับความช่วยเหลือ
			</p>
			
			<!-- Demo Flags (For testing kill-switches) -->
			<div class="mt-6 flex flex-wrap gap-4 rounded-xl bg-black/20 p-4 border border-white/10">
				<p class="text-xs font-bold text-white/50 w-full mb-1">Demo Kill-Switches (CR-005 Flags)</p>
				<label class="flex items-center gap-2 text-xs font-medium cursor-pointer">
					<input type="checkbox" bind:checked={public_metrics_occupancy} class="rounded border-white/30 bg-transparent" />
					Show Occupancy Metric
				</label>
				<label class="flex items-center gap-2 text-xs font-medium cursor-pointer">
					<input type="checkbox" bind:checked={public_metrics_vulnerable} class="rounded border-white/30 bg-transparent" />
					Show Vulnerable Metric (OP-8)
				</label>
			</div>
		</div>
	</div>

	<!-- 4 Metric Cards -->
	<div class="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-6">
		<PublicShelterMetricCard 
			title="ศูนย์พักพิงทั้งหมด" 
			value={data.summary.shelters_total} 
			unit="แห่ง" 
			icon={ClipboardList} 
			iconClass="bg-muted text-muted-foreground" 
		/>

		<PublicShelterMetricCard 
			title="เปิดใช้งาน" 
			value={data.summary.shelters_open} 
			unit="แห่ง" 
			icon={Building2} 
			iconClass="bg-success/15 text-success" 
		/>

		{#if public_metrics_occupancy}
			<PublicShelterMetricCard 
				title="ผู้พักพิงปัจจุบัน" 
				value={data.summary.occupancy_total} 
				unit="คน" 
				icon={Users} 
				iconClass="bg-primary-muted text-primary" 
			/>
		{:else}
			<div class="flex items-center gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-5 shadow-xs opacity-50">
				<div class="flex flex-col">
					<p class="text-xs font-medium text-muted-foreground">Occupancy Metric Hidden</p>
					<p class="text-[10px] text-muted-foreground">(Flag Disabled)</p>
				</div>
			</div>
		{/if}

		{#if public_metrics_vulnerable}
			<PublicShelterMetricCard 
				title="กลุ่มเปราะบาง" 
				value={data.summary.vulnerable_count} 
				unit="คน" 
				icon={AlertTriangle} 
				iconClass="bg-warning/15 text-warning-dark" 
			/>
		{:else}
			<div class="flex items-center gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-5 shadow-xs opacity-50">
				<div class="flex flex-col">
					<p class="text-xs font-medium text-muted-foreground">Vulnerable Metric Hidden</p>
					<p class="text-[10px] text-muted-foreground">(Flag Disabled)</p>
				</div>
			</div>
		{/if}
	</div>

	<!-- Main Content: Filters, Map, and List -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
		
		<!-- Left: Filters (3 columns on desktop) -->
		<div class="flex flex-col gap-5 lg:col-span-3">
			<div class="rounded-2xl border border-border bg-card p-5 shadow-xs">
				<div class="mb-4 flex items-center gap-2">
					<Filter class="h-4 w-4 text-primary" />
					<h3 class="font-bold text-foreground">ค้นหาและตัวกรอง</h3>
				</div>
				
				<form method="GET" action="/public/shelters" class="space-y-4">
					<div class="space-y-1.5">
						<label for="search" class="text-xs font-semibold text-muted-foreground">ค้นหา</label>
						<div class="relative">
							<input
								id="search"
								name="q"
								type="text"
								bind:value={searchQuery}
								placeholder="ชื่อศูนย์, ตำบล..."
								class="w-full rounded-xl border border-input bg-background px-3 py-2.5 pl-9 text-sm text-foreground shadow-xs outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
							/>
							<Search class="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
						</div>
					</div>

					<div class="space-y-1.5">
						<label for="province" class="text-xs font-semibold text-muted-foreground">จังหวัด</label>
						<select id="province" name="province" class="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground shadow-xs outline-hidden focus:border-primary focus:ring-1 focus:ring-primary">
							<option value="">จังหวัด (ทั้งหมด)</option>
							<option value="songkhla">สงขลา</option>
						</select>
					</div>

					<div class="space-y-1.5">
						<label for="district" class="text-xs font-semibold text-muted-foreground">อำเภอ/เขต</label>
						<select id="district" name="district" class="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground shadow-xs outline-hidden focus:border-primary focus:ring-1 focus:ring-primary">
							<option value="">อำเภอ (ทั้งหมด)</option>
							<option value="hatyai">หาดใหญ่</option>
							<option value="muang">เมืองสงขลา</option>
						</select>
					</div>
					
					<div class="space-y-1.5">
						<label for="subdistrict" class="text-xs font-semibold text-muted-foreground">ตำบล/แขวง</label>
						<select id="subdistrict" name="subdistrict" class="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground shadow-xs outline-hidden focus:border-primary focus:ring-1 focus:ring-primary">
							<option value="">ตำบล (ทั้งหมด)</option>
							<option value="korhong">คอหงส์</option>
						</select>
					</div>

					<div class="space-y-2 pt-2">
						<div class="text-xs font-semibold text-muted-foreground">ระยะทางเส้นทาง (กม.)</div>
						<div class="flex gap-2">
							<button class="flex-1 rounded-lg border border-border bg-background py-1.5 text-xs font-medium hover:bg-muted">5</button>
							<button class="flex-1 rounded-lg border-transparent bg-primary py-1.5 text-xs font-medium text-primary-foreground shadow-md">10</button>
							<button class="flex-1 rounded-lg border border-border bg-background py-1.5 text-xs font-medium hover:bg-muted">20</button>
							<button class="flex-1 rounded-lg border border-border bg-background py-1.5 text-xs font-medium hover:bg-muted">50</button>
						</div>
					</div>

					<div class="space-y-2 pt-2 border-t border-border mt-2">
						<div class="text-xs font-semibold text-muted-foreground">สถานะศูนย์พักพิง</div>
						<div class="flex items-center gap-4">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="checkbox" name="status" value="OPEN" checked class="rounded border-input text-primary focus:ring-primary" />
								<span class="text-sm font-medium text-foreground">เปิดใช้งาน</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="checkbox" name="status" value="CLOSED" class="rounded border-input text-primary focus:ring-primary" />
								<span class="text-sm font-medium text-foreground">ปิดใช้งาน</span>
							</label>
						</div>
					</div>
					
					<div class="pt-2 border-t border-border mt-4">
						<button type="submit" class="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary-dark">
							ค้นหาและกรองข้อมูล
						</button>
					</div>
				</form>
			</div>
		</div>

		<!-- Middle: Map Placeholder (5 columns on desktop) -->
		<div class="h-[400px] lg:col-span-5 lg:h-auto min-h-[500px]">
			<div class="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-slate-100 shadow-inner z-0">
				<!-- Map Container -->
				<div bind:this={mapElement} class="h-full w-full absolute inset-0 z-0"></div>
			</div>
		</div>

		<!-- Right: Shelter List (4 columns on desktop) -->
		<div class="flex flex-col gap-4 lg:col-span-4">
			<div class="flex items-center justify-between rounded-t-2xl bg-card px-1 py-1">
				<h3 class="font-bold text-foreground">รายชื่อศูนย์พักพิง <span class="text-muted-foreground text-sm font-medium ml-1">{data.shelters.length} แห่ง</span></h3>
				<Button size="sm" class="h-8 rounded-xl px-4 text-xs font-bold bg-primary-dark">ดูรายการทั้งหมด</Button>
			</div>

			<div class="flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar" style="max-height: 600px;">
				{#each data.shelters as shelter}
					<PublicShelterCard 
						{shelter} 
						{getStatusColor} 
						{getStatusText} 
					/>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	/* Custom scrollbar for the list */
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background-color: #cbd5e1;
		border-radius: 10px;
	}
	.custom-scrollbar:hover::-webkit-scrollbar-thumb {
		background-color: #94a3b8;
	}
</style>
