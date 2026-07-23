<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Eye from '@lucide/svelte/icons/eye';
	import Navigation from '@lucide/svelte/icons/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { PublicShelterCardModel } from '../domain/types';

	let {
		shelter,
		getStatusColor,
		getStatusText
	}: {
		shelter: PublicShelterCardModel;
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
			<span>{shelter.address} อ.{shelter.district}, จ.{shelter.province} </span>
		</div>
		<div class="ml-5">
			ระยะห่างจากจุดผู้ใช้:
			{#if shelter.distance !== undefined && shelter.distance !== null && !isNaN(shelter.distance) && shelter.distance > 0}
				<span class="font-bold text-foreground">{shelter.distance} กม.</span>
			{:else}
				<span class="font-medium text-muted-foreground">-</span>
			{/if}
		</div>
	</div>

	<!-- Capacity only (CR-017 — no occupancy on public_shelters) -->
	<div class="mt-1 flex flex-col gap-2.5 text-sm">
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium text-muted-foreground">ความจุศูนย์</span>
			<div class="font-bold text-foreground">
				<span class="text-sm">{shelter.capacity}</span>
				<span class="ml-0.5 text-xs font-bold">คน</span>
			</div>
		</div>
	</div>

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
			href={shelter.geo?.lat != null && shelter.geo?.lng != null
				? `https://www.google.com/maps/dir/?api=1&destination=${shelter.geo.lat},${shelter.geo.lng}`
				: undefined}
			target={shelter.geo?.lat != null && shelter.geo?.lng != null ? '_blank' : null}
			rel={shelter.geo?.lat != null && shelter.geo?.lng != null ? 'noopener noreferrer' : null}
			disabled={shelter.geo?.lat == null || shelter.geo?.lng == null}
			size="sm"
			class="h-9 flex-1 rounded-xl bg-primary-dark text-xs font-bold text-primary-foreground hover:bg-primary disabled:opacity-50"
		>
			<Navigation class="mr-1.5 h-3.5 w-3.5" /> นำทาง
		</Button>
	</div>
</Card.Root>
