<script lang="ts">
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		useDashboardZoneOccupancy,
		summarizeZoneOccupancy,
		toZoneOccupancies,
		type ZoneOccupancyLevel
	} from '$lib/features/dashboard';
	import { useShelter } from '$lib/features/shelters';
	import DashboardZoneSummaryCard from './dashboard-zone-summary-card.svelte';

	let { shelterCode }: { shelterCode: string } = $props();

	// Per-zone Present counts from the occupancy_by_zone view; capacity and status from the
	// shelter's zones[] (CR-226). Same thresholds as the shelter-list occupancy cell.
	const zoneQuery = useDashboardZoneOccupancy(() => shelterCode);
	const shelterQuery = useShelter(() => shelterCode);

	const zones = $derived(
		toZoneOccupancies(zoneQuery.data?.rows ?? [], shelterQuery.data?.zones ?? [])
	);
	const summary = $derived(summarizeZoneOccupancy(zones));
	const isPending = $derived(zoneQuery.isPending || shelterQuery.isPending);
	const isError = $derived(zoneQuery.isError || shelterQuery.isError);

	const BAR: Record<ZoneOccupancyLevel, string> = {
		normal: 'bg-emerald-500',
		warning: 'bg-amber-500',
		full: 'bg-red-500'
	};
	const BADGE: Record<ZoneOccupancyLevel, string> = {
		normal: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		warning: 'border-amber-200 bg-amber-50 text-amber-900',
		full: 'border-red-200 bg-red-50 text-red-900'
	};
</script>

<div class="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
	<div class="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
		<div class="mb-4 flex items-center gap-2">
			<LayoutGrid class="h-4 w-4 text-primary" />
			<h3 class="leading-none font-semibold tracking-tight">ความเต็มรายโซน</h3>
		</div>

		{#if isError}
			<Alert variant="destructive">
				<AlertCircle class="h-4 w-4" />
				<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
				<AlertDescription
					>ไม่สามารถโหลดข้อมูลความเต็มรายโซนได้ กรุณาลองใหม่อีกครั้ง</AlertDescription
				>
			</Alert>
		{:else if isPending}
			<Skeleton class="h-32 w-full" />
		{:else if zones.length === 0}
			<p class="text-sm text-muted-foreground">ศูนย์นี้ยังไม่มีโซน</p>
		{:else}
			<ul class="space-y-3">
				{#each zones as zone (zone.code)}
					<li class={['space-y-1', zone.closed && 'opacity-50']}>
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="flex min-w-0 items-center gap-2">
								<span class="truncate font-medium text-foreground">{zone.name}</span>
								{#if zone.closed}
									<span
										class="shrink-0 rounded-full border border-slate-300 bg-slate-100 px-1.5 text-xs font-semibold text-slate-700"
									>
										ปิด
									</span>
								{/if}
							</span>
							<span class="flex shrink-0 items-center gap-2 tabular-nums">
								<span class="text-muted-foreground">
									<strong class="font-bold text-foreground">{zone.count.toLocaleString()}</strong>
									/ {zone.capacity.toLocaleString()} คน
								</span>
								<span
									class="inline-flex items-center rounded-full border px-1.5 text-xs font-semibold {BADGE[
										zone.level
									]}"
								>
									{zone.percent}%
								</span>
							</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
							<div
								class="h-full rounded-full {BAR[zone.level]} transition-all duration-300"
								style:width="{Math.min(100, zone.percent)}%"
							></div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#if !isError && !isPending && zones.length > 0}
		<DashboardZoneSummaryCard {summary} />
	{/if}
</div>
