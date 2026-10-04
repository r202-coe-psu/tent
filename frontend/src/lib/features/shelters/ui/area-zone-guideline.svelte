<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import {
		areaAlignment,
		canSyncAreaFromZones,
		sumZoneAreas,
		sumCommonAreas,
		type ZoneAreaLike,
		type CommonAreasLike
	} from '../domain/area-guide';
	import Info from '@lucide/svelte/icons/info';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Calculator from '@lucide/svelte/icons/calculator';

	let {
		shelterArea,
		zones,
		commonAreas,
		disabled = false,
		onSyncFromZones
	}: {
		shelterArea: number | null | undefined;
		zones: ZoneAreaLike[] | null | undefined;
		commonAreas?: CommonAreasLike;
		disabled?: boolean;
		onSyncFromZones: (areaSum: number) => void;
	} = $props();

	const zoneList = $derived(zones ?? []);
	const zoneAreaSum = $derived(sumZoneAreas(zoneList));
	const commonAreaSum = $derived(sumCommonAreas(commonAreas));
	const hasCommonAreas = $derived(commonAreaSum > 0);
	const totalCalculatedArea = $derived(Math.round((zoneAreaSum + commonAreaSum) * 100) / 100);

	const alignment = $derived(areaAlignment(shelterArea, zoneAreaSum, zoneList.length));
	const showSync = $derived(canSyncAreaFromZones(shelterArea, zoneAreaSum, zoneList.length));
	const showTotalSync = $derived(
		hasCommonAreas &&
			totalCalculatedArea > 0 &&
			Math.abs(totalCalculatedArea - (Number(shelterArea) || 0)) >= 0.001 &&
			Math.abs(totalCalculatedArea - zoneAreaSum) >= 0.001
	);

	const statusLabel = $derived.by(() => {
		switch (alignment) {
			case 'aligned':
				return 'ผลรวมพื้นที่โซนตรงกับพื้นที่ใช้สอยรวมแล้ว';
			case 'zones_under':
				return 'ผลรวมพื้นที่โซนน้อยกว่าพื้นที่ใช้สอยรวม — อาจเหลือพื้นที่ส่วนกลางหรือยังไม่ได้จัดโซน';
			case 'zones_over':
				return 'ผลรวมพื้นที่โซนเกินพื้นที่ใช้สอยรวม — ควรปรับพื้นที่ศูนย์หรือลดขนาดพื้นที่โซน';
			default:
				return 'ยังไม่มีโซนหรือยังไม่ได้ระบุพื้นที่โซน';
		}
	});
</script>

<Alert
	class="rounded-xl border border-slate-200/80 bg-slate-50/70 {alignment === 'zones_over'
		? 'border-amber-200 bg-amber-50/80 text-amber-900'
		: 'text-slate-800'}"
>
	<Info class="h-4 w-4" />
	<AlertTitle class="text-sm font-semibold">แนวทางพื้นที่ใช้สอย (Total Area)</AlertTitle>
	<AlertDescription class="space-y-3 text-sm text-muted-foreground">
		<p>
			พื้นที่ใช้สอยรวมของศูนย์ใช้ประเมินสัดส่วนต่อหัวตามมาตรฐาน SPHERE ·
			ขนาดพื้นที่แต่ละโซนใช้จัดสรรพื้นที่พัก
		</p>
		<ul class="space-y-1 text-foreground">
			<li>
				พื้นที่ใช้สอยศูนย์ (Total Area):
				<span class="font-semibold tabular-nums">{Number(shelterArea) || 0}</span> ตร.ม.
			</li>
			<li>
				ผลรวมพื้นที่โซน:
				<span class="font-semibold tabular-nums">{zoneAreaSum}</span> ตร.ม.
				{#if zoneList.length > 0}
					<span class="text-muted-foreground">({zoneList.length} โซน)</span>
				{/if}
			</li>
			{#if hasCommonAreas}
				<li class="text-xs text-muted-foreground">
					พื้นที่ส่วนกลาง/คลัง/โลจิสติกส์:
					<span class="font-semibold text-foreground tabular-nums">{commonAreaSum}</span> ตร.ม.
					(รวมทั้งสิ้น:
					<span class="font-semibold text-foreground tabular-nums">{totalCalculatedArea}</span> ตร.ม.)
				</li>
			{/if}
			<li class="text-muted-foreground">{statusLabel}</li>
		</ul>
		<div class="flex flex-wrap items-center gap-2 pt-1">
			{#if showSync}
				<Button
					type="button"
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => onSyncFromZones(zoneAreaSum)}
					class="mt-1"
				>
					<ArrowRightLeft class="mr-1.5 h-3.5 w-3.5" />
					ปรับพื้นที่ใช้สอยให้เท่าผลรวมโซน ({zoneAreaSum} ตร.ม.)
				</Button>
			{/if}
			{#if showTotalSync}
				<Button
					type="button"
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => onSyncFromZones(totalCalculatedArea)}
					class="mt-1"
				>
					<Calculator class="mr-1.5 h-3.5 w-3.5" />
					ปรับตามผลรวมทั้งหมด ({totalCalculatedArea} ตร.ม.)
				</Button>
			{/if}
		</div>
	</AlertDescription>
</Alert>
