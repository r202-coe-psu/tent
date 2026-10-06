<script lang="ts">
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { useShelter, ZONE_TYPE_LABELS, type ZoneType } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import type { Evacuee, TriageLevel } from '$lib/features/people';
	import {
		recommendZoneKind,
		pickRecommendedZone,
		ZONE_KIND_LABELS,
		type PreferredZoneOutcome
	} from '$lib/features/people';

	export interface ZoneItem {
		code: string;
		name?: string;
		type?: string;
		status?: string;
		capacity?: number | null;
	}

	let {
		selected_zone = $bindable(''),
		shelter_zones,
		evacuee = null,
		triage_level = null,
		ewar_symptoms = null,
		preferred_zone = { kind: 'none' },
		occupant_counts,
		onSelectZone,
		disabled = false
	}: {
		selected_zone?: string;
		shelter_zones?: ZoneItem[];
		evacuee?: Evacuee | null;
		triage_level?: TriageLevel | null;
		ewar_symptoms?: readonly string[] | null;
		/** CR-155: what became of the zone Station 1 suggested (resolved by the caller). */
		preferred_zone?: PreferredZoneOutcome;
		occupant_counts?: Map<string, number> | Record<string, number>;
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

	/**
	 * Recommend only for one known person (or known symptoms). The bulk dialog passes no
	 * subject, and a per-person reason there would be wrong for most of the selection.
	 */
	const hasSubject = $derived(evacuee != null || ewar_symptoms != null || triage_level != null);

	const recommendedZoneType = $derived(
		recommendZoneKind(
			evacuee ?? { vulnerable_groups: [], special_needs: [] },
			ewar_symptoms ?? triage_level
		)
	);

	/** Null when no open zone has the recommended type — never another type's zone. */
	const recommendedZone = $derived(
		hasSubject ? pickRecommendedZone(activeZones, recommendedZoneType) : null
	);

	function occupantCount(code: string): number {
		if (!occupant_counts) return 0;
		if (occupant_counts instanceof Map) return occupant_counts.get(code) ?? 0;
		return occupant_counts[code] ?? 0;
	}

	function recommendLabel(kind: string): string {
		if (kind === 'quarantine') return 'แนะนำสำหรับผู้มีอาการเฝ้าระวัง (กักตัว)';
		if (kind === 'vulnerable') return 'แนะนำสำหรับผู้มีความต้องการพิเศษหรือกลุ่มเปราะบาง';
		return 'ไม่มีอาการเฝ้าระวังหรือความต้องการพิเศษ — แนะนำโซนทั่วไป';
	}

	/** Thai type name; zones saved without a type count as general. */
	function zoneTypeName(type: string | undefined): string {
		return ZONE_TYPE_LABELS[(type || 'general') as ZoneType] ?? type ?? '';
	}

	const isQuarantine = (zone: ZoneItem) => zone.type === 'quarantine';

	function zoneName(code: string): string {
		const zone = (shelter_zones ?? shelterQuery.data?.zones ?? []).find(
			(z: ZoneItem) => z.code === code
		);
		return zone?.name?.trim() || code;
	}

	function handleSelect(code: string) {
		selected_zone = code;
		onSelectZone?.(code);
	}
</script>

<div class="space-y-4">
	{#if preferred_zone.kind !== 'none'}
		<p
			class="rounded-lg border px-3 py-2 text-xs {preferred_zone.kind === 'use'
				? 'border-primary/30 bg-primary/5 text-foreground'
				: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'}"
			role="status"
		>
			{#if preferred_zone.kind === 'use'}
				โซนที่สถานี 1 ระบุไว้: <strong>{zoneName(preferred_zone.code)}</strong> — เลือกไว้ให้แล้ว เปลี่ยนได้
			{:else if preferred_zone.kind === 'quarantine_overrides'}
				สถานี 1 ระบุโซน <strong>{zoneName(preferred_zone.code)}</strong> ไว้ — ไม่ได้เลือกให้ เพราะมีอาการเฝ้าระวัง
				ต้องแยกไปโซนกักโรค
			{:else}
				โซนที่สถานี 1 ระบุไว้ ({preferred_zone.code}) ไม่เปิดใช้งานแล้ว — กรุณาเลือกโซนเอง
			{/if}
		</p>
	{/if}
	{#if hasSubject && !recommendedZone && activeZones.length > 0}
		<div
			role="status"
			class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100"
		>
			<p class="font-semibold">
				ไม่มี{ZONE_KIND_LABELS[recommendedZoneType]} ที่เปิดอยู่
			</p>
			<p class="mt-0.5">{recommendLabel(recommendedZoneType)} — กรุณาเลือกโซนด้วยตนเอง</p>
		</div>
	{:else if recommendedZone}
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
							<span class="text-2xs text-muted-foreground"
								>({zoneTypeName(recommendedZone.type)})</span
							>
						</div>
						<p class="mt-0.5 text-2xs text-muted-foreground">
							{recommendLabel(recommendedZoneType)}
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
						{match?.name?.trim() || match?.code || selected_zone}
					{:else}
						-- เลือกโซนที่พัก --
					{/if}
				</Select.Trigger>
				<Select.Content>
					{#each activeZones as zone (zone.code)}
						{@const isRec = recommendedZone?.code === zone.code}
						<Select.Item
							value={zone.code}
							label={`${zone.name?.trim() || zone.code} · ${isQuarantine(zone) ? '⚠ ' : ''}${zoneTypeName(zone.type)}${isRec ? ' ★ แนะนำ' : ''}`}
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
							: isQuarantine(zone)
								? 'border-red-500/50 bg-red-500/5 text-foreground hover:bg-red-500/10'
								: 'border-border bg-card text-foreground hover:bg-muted/40'}"
					>
						<div class="flex items-center gap-2">
							{#if isQuarantine(zone)}
								<ShieldAlert class="size-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
							{:else}
								<MapPin class="size-3.5 text-muted-foreground" />
							{/if}
							<div>
								<div class="flex flex-wrap items-center gap-1.5">
									<span>{zone.name?.trim() || zone.code}</span>
									<span
										class="rounded px-1 text-[10px] font-bold {isQuarantine(zone)
											? 'bg-red-600 text-white dark:bg-red-500'
											: 'bg-muted text-muted-foreground'}"
									>
										{isQuarantine(zone) ? 'โซน' : ''}{zoneTypeName(zone.type)}
									</span>
									{#if isRec}
										<span
											class="py-0.2 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200"
										>
											แนะนำ
										</span>
									{/if}
								</div>
								<span class="text-2xs text-muted-foreground">
									พักอยู่ {occupantCount(zone.code)}
									{zone.capacity != null ? `/ ${zone.capacity}` : ''} คน
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
