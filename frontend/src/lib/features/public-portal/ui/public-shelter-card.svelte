<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Eye from '@lucide/svelte/icons/eye';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Dog from '@lucide/svelte/icons/dog';
	import Car from '@lucide/svelte/icons/car';
	import Accessibility from '@lucide/svelte/icons/accessibility';
	import Wifi from '@lucide/svelte/icons/wifi';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	let {
		shelter,
		getStatusColor,
		getStatusText
	}: {
		shelter: Record<string, unknown> & {
			id: string;
			name: string;
			status: string;
			address: string;
			distance: number;
			occupancy: number;
			capacity: number;
			available: number;
			geo: { lat: number; lng: number };
			capabilities?: Record<string, boolean>;
		};
		getStatusColor: (status: string) => string;
		getStatusText: (status: string) => string;
	} = $props();
</script>

<Card.Root
	class="flex flex-col gap-2! rounded-2xl border-border p-5 shadow-xs transition-colors hover:border-primary/30 hover:bg-muted/10"
>
	<!-- Title and Status -->
	<div class=" flex items-start justify-between gap-2">
		<h4 class="leading-tight font-bold text-foreground">{shelter.name}</h4>
		<span
			class="shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold {getStatusColor(
				shelter.status
			)}"
		>
			<span class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>{getStatusText(
				shelter.status
			)}
		</span>
	</div>

	<!-- Address and Distance -->
	<div class=" flex flex-col gap-1.5 text-xs text-muted-foreground">
		<div class="flex items-start gap-1.5">
			<MapPin class="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<span>{shelter.address}</span>
		</div>
		<div class="ml-5">
			ระยะห่างจากจุดศูนย์กลาง: <span class="font-bold text-foreground">{shelter.distance} กม.</span>
		</div>
	</div>

	<!-- Occupancy and Capacity -->
	<div class="mt-1 flex flex-col gap-2.5 text-sm">
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium text-muted-foreground">ผู้พักพิงปัจจุบัน</span>
			<div class="font-bold text-foreground">
				<span class="text-sm">{shelter.occupancy}/{shelter.capacity}</span>
				<span class="ml-0.5 text-xs font-bold">คน</span>
			</div>
		</div>
		<div class="flex items-center justify-between border-t border-border pt-2.5">
			<span class="text-xs font-medium text-muted-foreground">จำนวนที่ว่าง</span>
			<div class="font-bold text-success">
				<span class="text-sm">{shelter.available}</span>
				<span class="ml-0.5 text-xs font-bold text-success">คน</span>
			</div>
		</div>
	</div>

	<!-- Capabilities Badges -->
	{#if shelter.capabilities}
		<div class="mt-1 flex flex-wrap gap-2">
			{#if shelter.capabilities.pet_general || shelter.capabilities.pet_large || shelter.capabilities.pet_livestock}
				<div
					class="inline-flex items-center gap-1 rounded border border-[#f0c14b]/60 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-[#c4901b]"
				>
					<Dog class="h-3.5 w-3.5 text-[#8b610c]" /> รับสัตว์เลี้ยง
				</div>
			{/if}
			{#if shelter.capabilities.parking_car || shelter.capabilities.parking_motorcycle || shelter.capabilities.parking_boat}
				<div
					class="inline-flex items-center gap-1 rounded border border-[#bfdbfe] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-[#2563eb]"
				>
					<Car class="h-3.5 w-3.5 text-[#1d4ed8]" /> ที่จอดรถ
				</div>
			{/if}
			{#if shelter.capabilities.vulnerable_wheelchair || shelter.capabilities.vulnerable_bed}
				<div
					class="inline-flex items-center gap-1 rounded border border-[#ddd6fe] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-[#7c3aed]"
				>
					<Accessibility class="h-3.5 w-3.5 text-[#6d28d9]" /> วีลแชร์/ติดเตียง
				</div>
			{/if}
			{#if shelter.capabilities.utility_wifi}
				<div
					class="inline-flex items-center gap-1 rounded border border-[#bbf7d0] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-[#16a34a]"
				>
					<Wifi class="h-3.5 w-3.5 text-[#15803d]" /> Wi-Fi
				</div>
			{/if}
		</div>
	{/if}

	<!-- Actions -->
	<div class="mt-auto flex gap-2">
		<Button
			href={`/public/shelters/${shelter.id}`}
			variant="outline"
			size="sm"
			class="h-9 flex-1 rounded-xl border-border text-xs font-bold text-foreground hover:bg-muted"
		>
			<Eye class="mr-1.5 h-3.5 w-3.5" /> ดูรายละเอียด
		</Button>
		<Button
			href={shelter.geo
				? `https://www.google.com/maps/dir/?api=1&destination=${shelter.geo.lat},${shelter.geo.lng}`
				: '#'}
			target={shelter.geo ? '_blank' : null}
			rel={shelter.geo ? 'noopener noreferrer' : null}
			size="sm"
			class="h-9 flex-1 rounded-xl bg-primary-dark text-xs font-bold text-primary-foreground hover:bg-primary"
		>
			<Navigation class="mr-1.5 h-3.5 w-3.5" /> นำทาง
		</Button>
	</div>
</Card.Root>
