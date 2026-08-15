<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import {
		capacityAlignment,
		canSyncCapacityFromZones,
		sumZoneCapacities,
		type ZoneCapacityLike
	} from '../domain/capacity-guide';
	import Info from '@lucide/svelte/icons/info';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';

	let {
		shelterCapacity,
		zones,
		disabled = false,
		onSyncFromZones
	}: {
		shelterCapacity: number;
		zones: ZoneCapacityLike[] | null | undefined;
		disabled?: boolean;
		onSyncFromZones: (zoneSum: number) => void;
	} = $props();

	const zoneList = $derived(zones ?? []);
	const zoneSum = $derived(sumZoneCapacities(zoneList));
	const alignment = $derived(capacityAlignment(shelterCapacity, zoneSum, zoneList.length));
	const showSync = $derived(canSyncCapacityFromZones(shelterCapacity, zoneSum, zoneList.length));

	const statusLabel = $derived.by(() => {
		switch (alignment) {
			case 'aligned':
				return 'ผลรวมโซนตรงกับความจุศูนย์แล้ว';
			case 'zones_under':
				return 'ผลรวมโซนน้อยกว่าความจุศูนย์ — อาจเหลือโควตาที่ยังไม่ได้จัดโซน';
			case 'zones_over':
				return 'ผลรวมโซนเกินความจุศูนย์ — ควรปรับความจุศูนย์หรือลดความจุโซน';
			default:
				return 'ยังไม่มีโซน — ความจุศูนย์ใช้เป็นเพดานจนกว่าจะตั้งค่าโซน';
		}
	});
</script>

<Alert
	class="border-shelter-border bg-muted/40 {alignment === 'zones_over'
		? 'border-amber-300 bg-amber-50/80'
		: ''}"
>
	<Info class="h-4 w-4" />
	<AlertTitle class="text-sm font-semibold">แนวทางความจุ (Max Capacity)</AlertTitle>
	<AlertDescription class="space-y-3 text-sm text-muted-foreground">
		<p>
			ความจุสูงสุดของศูนย์คือตัวเลขที่ใช้แสดง occupancy / dashboard · ความจุแต่ละโซนใช้จัดที่พัก ·
			ผลรวมโซนควร ≤ ความจุศูนย์
		</p>
		<ul class="space-y-1 text-foreground">
			<li>
				ความจุศูนย์ (Max Capacity):
				<span class="font-semibold tabular-nums">{Number(shelterCapacity) || 0}</span> คน
			</li>
			<li>
				ผลรวมความจุโซน:
				<span class="font-semibold tabular-nums">{zoneSum}</span> คน
				{#if zoneList.length > 0}
					<span class="text-muted-foreground">({zoneList.length} โซน)</span>
				{/if}
			</li>
			<li class="text-muted-foreground">{statusLabel}</li>
		</ul>
		{#if showSync}
			<Button
				type="button"
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => onSyncFromZones(zoneSum)}
				class="mt-1"
			>
				<ArrowRightLeft class="mr-1.5 h-3.5 w-3.5" />
				ปรับความจุศูนย์ให้เท่าผลรวมโซน ({zoneSum} คน)
			</Button>
		{/if}
	</AlertDescription>
</Alert>
