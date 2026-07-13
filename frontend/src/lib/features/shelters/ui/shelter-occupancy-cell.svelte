<script lang="ts">
	import { useDashboardOccupancy } from '$lib/features/dashboard';

	let { code, capacity }: { code: string; capacity: number } = $props();

	const occupancyQuery = useDashboardOccupancy(() => code);

	const active = $derived(occupancyQuery.data?.active ?? 0);
	const ratio = $derived(capacity > 0 ? active / capacity : 0);
	const percent = $derived(Math.min(100, Math.round(ratio * 100)));

	const barColor = $derived(
		ratio >= 1 ? 'bg-rose-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
	);
</script>

{#if occupancyQuery.isLoading}
	<span class="text-xs text-muted-foreground">กำลังโหลด...</span>
{:else if occupancyQuery.isError}
	<span class="text-xs text-destructive">โหลดจำนวนผู้พักไม่สำเร็จ</span>
{:else}
	<div class="min-w-36 space-y-1">
		<div class="flex items-baseline justify-between text-xs">
			<span class="font-semibold text-foreground">{active} / {capacity} คน</span>
			<span class="text-muted-foreground">{percent}%</span>
		</div>
		<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
			<div
				class="h-full rounded-full {barColor} transition-[width]"
				style="width: {percent}%"
			></div>
		</div>
	</div>
{/if}
