<script lang="ts">
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import type { Evacuee } from '$lib/features/people';

	export interface ZoneItem {
		code: string;
		name?: string;
		type?: string;
		status?: string;
	}

	let {
		selected_zone = $bindable(''),
		shelter_zones,
		evacuee = null,
		onSelectZone,
		disabled = false
	}: {
		selected_zone?: string;
		shelter_zones?: ZoneItem[];
		evacuee?: Evacuee | null;
		onSelectZone?: (zoneCode: string) => void;
		disabled?: boolean;
	} = $props();

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const shelterQuery = safeQuery(
		() => useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode()),
		{ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<
			typeof useShelter
		>
	);

	const activeZones = $derived.by(() => {
		const raw = shelter_zones ?? shelterQuery.data?.zones ?? [];
		return raw.filter((z: ZoneItem) => z.status !== 'closed');
	});

	const recommendedZoneType = $derived.by(() => {
		if (evacuee?.special_needs && evacuee.special_needs.length > 0) {
			return 'vulnerable';
		}
		return 'general';
	});

	const recommendedZone = $derived.by(() => {
		const matches = activeZones.filter(
			(z: ZoneItem) => (z.type || 'general') === recommendedZoneType
		);
		if (matches.length > 0) return matches[0];
		return activeZones[0] || null;
	});

	function handleSelect(code: string) {
		selected_zone = code;
		onSelectZone?.(code);
	}
</script>

<div class="space-y-4">
	{#if recommendedZone}
		{@const isRecSelected = selected_zone === recommendedZone.code}
		<div
			class="rounded-xl border p-3 transition-colors {isRecSelected
				? 'border-primary/60 bg-primary/5'
				: 'border-border/80 bg-muted/20'}"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-start gap-2.5">
					<div
						class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<Sparkles class="size-4" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-xs font-bold text-foreground">โซนแนะนำ:</span>
							<span class="text-xs font-bold text-primary"
								>{recommendedZone.name || recommendedZone.code}</span
							>
						</div>
						<p class="mt-0.5 text-2xs text-muted-foreground">
							{recommendedZone.type === 'vulnerable'
								? 'แนะนำสำหรับผู้มีความต้องการพิเศษหรือกลุ่มเปราะบาง'
								: 'โซนที่พักทั่วไป'}
						</p>
					</div>
				</div>

				{#if !disabled && !isRecSelected}
					<button
						type="button"
						onclick={() => handleSelect(recommendedZone.code)}
						class="rounded-md border border-primary/40 bg-primary px-2.5 py-1 text-2xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
					>
						เลือกโซนแนะนำ
					</button>
				{:else if isRecSelected}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-2xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
					>
						<CheckCircle class="size-3" /> เลือกอยู่
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Zone Selection Dropdown -->
	<div class="space-y-1.5">
		<Label class="text-xs font-semibold text-foreground">
			เลือกโซนที่พัก (Active Shelter Zones)
		</Label>
		{#if activeZones.length === 0}
			<p
				class="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground"
			>
				ไม่พบรายการโซนในระบบ
			</p>
		{:else}
			<Select.Root
				type="single"
				value={selected_zone}
				onValueChange={(val) => {
					if (val) handleSelect(val);
				}}
				{disabled}
			>
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
					{#if selected_zone}
						{@const match = activeZones.find((z) => z.code === selected_zone)}
						{match ? `${match.name || match.code} (${match.code.toUpperCase()})` : selected_zone}
					{:else}
						-- เลือกโซนที่พัก --
					{/if}
				</Select.Trigger>
				<Select.Content>
					{#each activeZones as zone (zone.code)}
						{@const isRec = recommendedZone?.code === zone.code}
						<Select.Item
							value={zone.code}
							label={`${zone.name || zone.code} (${zone.code.toUpperCase()})${isRec ? ' ★ แนะนำ' : ''}`}
						/>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
	</div>

	<!-- List of zones for quick tap/click -->
	{#if activeZones.length > 0}
		<div class="space-y-1.5 pt-1">
			<span class="text-2xs font-medium text-muted-foreground">รายการโซนทั้งหมด:</span>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each activeZones as zone (zone.code)}
					{@const isSelected = selected_zone === zone.code}
					{@const isRec = recommendedZone?.code === zone.code}
					<button
						type="button"
						{disabled}
						onclick={() => handleSelect(zone.code)}
						class="flex items-center justify-between rounded-lg border p-2.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 {isSelected
							? 'border-primary bg-primary/5 font-semibold text-primary'
							: 'border-border bg-card text-foreground hover:bg-muted/40'}"
					>
						<div class="flex items-center gap-2">
							<MapPin class="size-3.5 text-muted-foreground" />
							<div>
								<div class="flex items-center gap-1.5">
									<span>{zone.name || zone.code}</span>
									{#if isRec}
										<span
											class="py-0.2 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200"
										>
											แนะนำ
										</span>
									{/if}
								</div>
								<span class="text-2xs text-muted-foreground">
									รหัส: {zone.code.toUpperCase()}
									{zone.type ? `| ${zone.type}` : ''}
								</span>
							</div>
						</div>
						{#if isSelected}
							<CheckCircle class="size-4 text-primary" />
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
