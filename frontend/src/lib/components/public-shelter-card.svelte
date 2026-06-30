<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Eye from '@lucide/svelte/icons/eye';
	import Navigation from '@lucide/svelte/icons/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	let {
		shelter,
		getStatusColor,
		getStatusText
	}: {
		shelter: any;
		getStatusColor: (status: string) => string;
		getStatusText: (status: string) => string;
	} = $props();
</script>

<Card.Root class="flex flex-col rounded-2xl border-border shadow-xs transition-colors hover:border-primary/30 hover:bg-muted/10 p-5">
	<!-- Title and Status -->
	<div class="mb-3 flex items-start justify-between gap-2">
		<h4 class="font-bold text-foreground leading-tight">{shelter.name}</h4>
		<span class="shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold {getStatusColor(shelter.status)}">
			<span class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>{getStatusText(shelter.status)}
		</span>
	</div>

	<!-- Address and Distance -->
	<div class="mb-4 flex flex-col gap-1.5 text-xs text-muted-foreground">
		<div class="flex items-start gap-1.5">
			<MapPin class="h-3.5 w-3.5 shrink-0 mt-0.5" />
			<span>{shelter.address}</span>
		</div>
		<div class="ml-5">
			ระยะห่างจากจุดศูนย์กลาง: <span class="font-bold text-foreground">{shelter.distance} กม.</span>
		</div>
	</div>

	<!-- Occupancy and Capacity -->
	<div class="mb-5 flex flex-col gap-2 rounded-xl bg-muted/40 p-3 text-sm">
		<div class="flex justify-between items-center">
			<span class="text-muted-foreground font-medium text-xs">ผู้พักพิงปัจจุบัน</span>
			<div class="font-bold text-foreground">
				<span class="text-base">{shelter.occupancy}</span><span class="text-muted-foreground font-normal">/{shelter.capacity}</span>
				<span class="text-xs ml-1 font-normal text-muted-foreground">คน</span>
			</div>
		</div>
		<div class="flex justify-between items-center border-t border-border/60 pt-2">
			<span class="text-success font-medium text-xs">จำนวนที่ว่าง</span>
			<div class="font-bold text-success">
				{shelter.available} <span class="text-xs font-normal">คน</span>
			</div>
		</div>
	</div>

	<!-- Actions -->
	<div class="mt-auto flex gap-2">
		<Button 
			onclick={() => window.open(`/public/shelters/${shelter.id}`, '_blank')}
			variant="outline" size="sm" class="flex-1 h-9 rounded-xl border-border text-xs font-bold text-foreground hover:bg-muted">
			<Eye class="mr-1.5 h-3.5 w-3.5" /> ดูรายละเอียด
		</Button>
		<Button size="sm" class="flex-1 h-9 rounded-xl bg-primary-dark text-xs font-bold text-primary-foreground hover:bg-primary">
			<Navigation class="mr-1.5 h-3.5 w-3.5" /> นำทาง
		</Button>
	</div>
</Card.Root>
