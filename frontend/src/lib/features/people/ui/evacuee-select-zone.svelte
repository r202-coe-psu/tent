<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter, type Zone } from '$lib/features/shelters/index.js';
	import type { Evacuee } from '../domain/people';

	let {
		evacuee,
		onBack,
		onSubmit
	}: {
		evacuee?: Evacuee | null;
		onBack: () => void;
		onSubmit: (zone: string) => void;
	} = $props();

	let selectedZone = $state('');

	// Query current shelter data to get zones
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());

	// Filter only active zones
	let activeZones = $derived(
		(shelterQuery.data?.zones || []).filter((z: Zone) => z.status !== 'closed')
	);

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
	<div class="flex items-center gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
		<div
			class="flex h-10 w-10 items-center justify-center rounded-full bg-[#e2e8f0] text-lg font-bold text-slate-700"
		>
			6
		</div>
		<div>
			<h2 class="text-lg font-bold">จัดสรรพื้นที่ (Zoning)</h2>
			<p class="text-sm text-muted-foreground">พิมพ์สลิปและข้อปฏิบัติ</p>
		</div>
	</div>

	<!-- Form Content -->
	<div
		class="flex flex-col items-center justify-center space-y-4 rounded-xl border border-blue-200 bg-[#f0f9ff] p-8 text-center shadow-sm"
	>
		<div class="space-y-1">
			<p class="text-lg font-medium text-foreground">โซนแนะนำ:</p>
			{#if shelterQuery.isLoading}
				<p class="animate-pulse text-sm text-muted-foreground">กำลังโหลดข้อมูลโซน...</p>
			{:else if recommendedZone}
				<h3 class="mt-2 flex items-center justify-center gap-2 text-2xl font-bold">
					<span class="text-3xl">
						{recommendedZone.type === 'vulnerable' ? '🟣' : '🟢'}
					</span>
					{recommendedZone.name}
				</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					แนะนำตามสถานะของผู้อพยพ ({recommendedZone.type === 'vulnerable'
						? 'กลุ่มเปราะบาง'
						: 'บุคคลทั่วไป'})
				</p>
			{:else}
				<h3
					class="mt-2 flex items-center justify-center gap-2 text-lg font-bold text-muted-foreground"
				>
					ไม่มีโซนที่เปิดให้บริการในศูนย์นี้
				</h3>
			{/if}
		</div>

		{#if activeZones.length > 0}
			<div class="mt-4 w-full max-w-sm">
				<Select.Root type="single" bind:value={selectedZone}>
					<Select.Trigger class="h-12 w-full rounded-xl border-border bg-white shadow-sm">
						{@const currentZone = activeZones.find((z: Zone) => z.code === selectedZone)}
						<span class="flex items-center gap-2 text-base font-medium">
							{currentZone ? `📍 ${currentZone.name}` : 'เลือกโซน...'}
						</span>
					</Select.Trigger>
					<Select.Content class="rounded-xl">
						{#each activeZones as zone (zone.code)}
							<Select.Item value={zone.code} class="text-base font-medium">
								📍 {zone.name}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
	</div>

	<!-- Bottom Actions -->
	<div class="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-sm">
		<Button
			type="button"
			disabled={!selectedZone || shelterQuery.isLoading}
			class="h-12 w-full rounded-xl bg-[#003B71] text-sm font-medium hover:bg-[#002a50] md:text-base"
			onclick={() => onSubmit(selectedZone)}
		>
			ยืนยันการเลือกโซน และไปขั้นตอนถัดไป &gt;
		</Button>
		<Button
			type="button"
			variant="outline"
			class="h-12 w-full rounded-xl text-sm font-medium md:text-base"
			onclick={onBack}
		>
			ย้อนกลับ
		</Button>
	</div>
</div>
