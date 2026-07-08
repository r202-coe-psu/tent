<script lang="ts">
	import type { PageData } from './$types';

	// Icons
	import Building2 from '@lucide/svelte/icons/building-2';
	import Users from '@lucide/svelte/icons/users';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';

	import { Button } from '$lib/components/ui/button';
	import Card from '$lib/components/ui/card/card.svelte';
	import {
		PublicShelterMetricCard,
		PublicShelterCard,
		ShelterFilterPanel,
		ShelterMap,
		PublicHeroMetrics
	} from '$lib/features/public-portal';

	let { data }: { data: PageData } = $props();

	let liveUserLat = $state('');
	let liveUserLng = $state('');

	function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
		const R = 6371; // km
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLon = ((lon2 - lon1) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos((lat1 * Math.PI) / 180) *
				Math.cos((lat2 * Math.PI) / 180) *
				Math.sin(dLon / 2) *
				Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	let displayShelters = $derived(
		data.shelters.map((s: any) => {
			if (liveUserLat && liveUserLng && s.geo?.lat && s.geo?.lng) {
				const dist = calcDistance(
					parseFloat(liveUserLat),
					parseFloat(liveUserLng),
					s.geo.lat,
					s.geo.lng
				);
				return { ...s, distance: parseFloat(dist.toFixed(1)) };
			}
			return s;
		})
	);

	$effect(() => {
		if (data.filters.user_lat) liveUserLat = data.filters.user_lat.toString();
		if (data.filters.user_lng) liveUserLng = data.filters.user_lng.toString();
	});

	function getStatusColor(status: string) {
		switch (status) {
			case 'OPEN':
				return 'bg-transparent text-success border-border/80';
			case 'FULL':
				return 'bg-transparent text-danger border-border/80';
			case 'PREPARE':
				return 'bg-transparent text-warning border-border/80';
			default:
				return 'bg-transparent text-muted-foreground border-border/80';
		}
	}

	function getStatusText(status: string) {
		switch (status) {
			case 'OPEN':
				return 'เปิดใช้งาน';
			case 'FULL':
				return 'เต็มความจุ';
			case 'PREPARE':
				return 'เตรียมพร้อม';
			default:
				return 'ปิดทำการ';
		}
	}
</script>

<svelte:head>
	<title>ตรวจสอบสถานะศูนย์พักพิง - Smart Shelter</title>
</svelte:head>

<div class="mx-auto max-w-[95rem] px-4 py-8 md:px-6">
	<!-- Header / Hero Section -->
	<PublicHeroMetrics
		title="ตรวจสอบสถานะศูนย์พักพิง"
		description="ข้อมูลรวมศูนย์พักพิง สถานะความจุ และเปอร์เซ็นต์ความหนาแน่นของผู้ประสบภัยตามเวลาจริง เพื่อประกอบการตัดสินใจเคลื่อนย้ายและขอรับความช่วยเหลือ"
		badgeText="Public Shelter Dashboard"
		badgeIcon={Building2}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- 4 Metric Cards -->
	<div class="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-6">
		<PublicShelterMetricCard
			title="ศูนย์พักพิงทั้งหมด"
			value={data.summary.shelters_total}
			unit="แห่ง"
			icon={ClipboardList}
			iconClass="border-accent-purple shadow-accent-purple/15 text-accent-purple"
		/>

		<PublicShelterMetricCard
			title="ศูนย์พักพิงที่เปิดใช้งาน"
			value={data.summary.shelters_open}
			unit="แห่ง"
			icon={Building2}
			iconClass="border-success shadow-success/15 text-success"
		/>

		{#if data.flags?.public_metrics_occupancy}
			<PublicShelterMetricCard
				title="ผู้พักพิงปัจจุบัน"
				value={data.summary.occupancy_total}
				unit="คน"
				icon={Users}
				iconClass="border-primary shadow-primary/15 text-primary"
			/>
		{/if}

		{#if data.flags?.public_metrics_vulnerable}
			<PublicShelterMetricCard
				title="กลุ่มเปราะบาง"
				value={data.summary.vulnerable_count}
				unit="คน"
				icon={AlertTriangle}
				iconClass="border-warning shadow-warning/15 text-warning-dark"
			/>
		{/if}
	</div>

	<!-- Main Content: Filters, Map, and List -->
	<Card class="rounded-6xl! grid grid-cols-1 gap-6 p-6 lg:grid-cols-12">
		<!-- Left: Filters (3 columns on desktop) -->
		<div class="flex flex-col gap-5 lg:col-span-3">
			<ShelterFilterPanel
				filters={data.filters}
				availableTypes={data.available_types}
				action="/public/shelters"
				bind:userLat={liveUserLat}
				bind:userLng={liveUserLng}
			/>
		</div>

		<!-- Middle: Map (5 columns on desktop) -->
		<div class="h-100 min-h-125 lg:col-span-5 lg:h-auto">
			<div
				class="relative z-0 h-full w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-inner"
			>
				<ShelterMap
					shelters={displayShelters}
					userLocation={{ lat: parseFloat(liveUserLat), lng: parseFloat(liveUserLng) }}
				/>
			</div>
		</div>

		<!-- Right: Shelter List (4 columns on desktop) -->
		<div class="flex h-100 min-h-125 flex-col gap-4 lg:col-span-4 lg:h-auto">
			<div class="flex items-center justify-between rounded-t-2xl bg-card px-1 py-1">
				<h3 class="font-bold text-foreground">
					รายชื่อศูนย์พักพิง <span class="ml-1 text-sm font-medium text-muted-foreground"
						>{displayShelters.length} แห่ง</span
					>
				</h3>
				<!-- <Button size="sm" class="h-8 rounded-xl bg-primary-dark px-4 text-xs font-bold"
					>ดูรายการทั้งหมด</Button
				> -->
			</div>

			<div
				class="custom-scrollbar flex flex-col gap-4 overflow-y-auto pr-2"
				style="max-height: 700px;"
			>
				{#each displayShelters as shelter (shelter.id)}
					<PublicShelterCard {shelter} {getStatusColor} {getStatusText} />
				{/each}
			</div>
		</div>
	</Card>
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
