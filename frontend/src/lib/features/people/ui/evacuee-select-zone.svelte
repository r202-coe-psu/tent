<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter, type Zone } from '$lib/features/shelters/index.js';
	
	let {
		evacuee,
		onBack,
		onSubmit
	}: {
		evacuee?: any;
		onBack: () => void;
		onSubmit: (zone: string) => void;
	} = $props();
	
	let selectedZone = $state('');

	// Query current shelter data to get zones
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? '');

	// Filter only active zones
	let activeZones = $derived((shelterQuery.data?.zones || []).filter((z: Zone) => z.status !== 'closed'));

	// AI Smart Zoning Recommendation
	const recommendedZoneType = $derived.by(() => {
		if (evacuee?.special_needs && evacuee.special_needs.length > 0) {
			return 'vulnerable';
		}
		return 'general';
	});

	const recommendedZone = $derived.by(() => {
		const matches = activeZones.filter((z: Zone) => (z.type || 'general') === recommendedZoneType);
		if (matches.length > 0) return matches[0];
		return activeZones[0] || null;
	});

	// Automatically select the recommended zone initially
	$effect(() => {
		if (recommendedZone && !selectedZone) {
			selectedZone = recommendedZone.code;
		}
	});
</script>

<div class="space-y-4">
	<!-- Header Card -->
	<div class="rounded-xl border border-border bg-card p-6 shadow-sm flex items-center gap-4">
		<div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#e2e8f0] text-slate-700 font-bold text-lg">
			6
		</div>
		<div>
			<h2 class="text-lg font-bold">จัดสรรพื้นที่ (Zoning)</h2>
			<p class="text-sm text-muted-foreground">พิมพ์สลิปและข้อปฏิบัติ</p>
		</div>
	</div>

	<!-- Form Content -->
	<div class="rounded-xl border border-blue-200 bg-[#f0f9ff] p-8 shadow-sm flex flex-col items-center justify-center space-y-4 text-center">
		<div class="space-y-1">
			<p class="text-[10px] font-bold text-blue-900 tracking-wider">ระบบคัดแยกอัตโนมัติ (AI SMART ZONING)</p>
			<p class="text-lg font-medium text-foreground">โซนแนะนำ:</p>
			{#if shelterQuery.isLoading}
				<p class="text-sm text-muted-foreground animate-pulse">กำลังโหลดข้อมูลโซน...</p>
			{:else}
				{#if recommendedZone}
					<h3 class="text-2xl font-bold flex items-center gap-2 justify-center mt-2">
						<span class="text-3xl">
							{recommendedZone.type === 'vulnerable' ? '🟣' : '🟢'}
						</span>
						{recommendedZone.name}
					</h3>
					<p class="text-xs text-muted-foreground mt-1">
						แนะนำตามสถานะของผู้อพยพ ({recommendedZone.type === 'vulnerable' ? 'กลุ่มเปราะบาง' : 'บุคคลทั่วไป'})
					</p>
				{:else}
					<h3 class="text-lg font-bold flex items-center gap-2 justify-center mt-2 text-muted-foreground">
						ไม่มีโซนที่เปิดให้บริการในศูนย์นี้
					</h3>
				{/if}
			{/if}
		</div>
		
		{#if activeZones.length > 0}
			<div class="w-full max-w-sm mt-4">
				<Select.Root type="single" bind:value={selectedZone}>
					<Select.Trigger class="w-full h-12 bg-white rounded-xl shadow-sm border-border">
						{@const currentZone = activeZones.find((z: Zone) => z.code === selectedZone)}
						<span class="flex items-center gap-2 text-base font-medium">
							{currentZone ? `📍 ${currentZone.name}` : 'เลือกโซน...'}
						</span>
					</Select.Trigger>
					<Select.Content class="rounded-xl">
						{#each activeZones as zone (zone.code)}
							<Select.Item value={zone.code} class="text-base font-medium">
								📍 {zone.name} ({zone.capacity} คน)
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
	</div>

	<!-- Bottom Actions -->
	<div class="flex flex-col gap-3 bg-card p-6 rounded-xl border shadow-sm">
		<Button 
			type="button" 
			disabled={!selectedZone || shelterQuery.isLoading} 
			class="w-full h-12 text-sm md:text-base font-medium bg-[#003B71] hover:bg-[#002a50] rounded-xl" 
			onclick={() => onSubmit(selectedZone)}
		>
			ยืนยันการเลือกโซน และไปขั้นตอนถัดไป &gt;
		</Button>
		<Button type="button" variant="outline" class="w-full h-12 text-sm md:text-base font-medium rounded-xl" onclick={onBack}>
			ย้อนกลับ
		</Button>
	</div>
</div>
