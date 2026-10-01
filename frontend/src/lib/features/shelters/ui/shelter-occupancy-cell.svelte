<script lang="ts">
	import { useDashboardOccupancy } from '$lib/features/dashboard';

	let { code, capacity }: { code: string; capacity: number } = $props();

	const occupancyQuery = useDashboardOccupancy(() => code);

	const active = $derived(occupancyQuery.data?.active ?? 0);
	const ratio = $derived(capacity > 0 ? active / capacity : 0);
	const percent = $derived(Math.min(100, Math.round(ratio * 100)));

	const barColor = $derived(
		ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
	);
	const badgeStyle = $derived(
		ratio >= 1
			? 'border-red-200 bg-red-50 text-red-900'
			: ratio >= 0.8
				? 'border-amber-200 bg-amber-50 text-amber-900'
				: 'border-emerald-200 bg-emerald-50 text-emerald-900'
	);
</script>

{#if occupancyQuery.isLoading}
	<span class="text-xs text-slate-400">กำลังโหลด...</span>
{:else if occupancyQuery.isError}
	<span class="text-xs text-red-500">โหลดไม่สำเร็จ</span>
{:else}
	<div class="max-w-44 min-w-32 space-y-1">
		<div class="flex items-center justify-between text-xs">
			<span class="font-medium text-slate-700 tabular-nums">
				<strong class="font-bold text-slate-900">{active.toLocaleString()}</strong> / {capacity.toLocaleString()}
				คน
			</span>
			<span
				class="py-0.2 inline-flex items-center rounded-full border px-1.5 text-xs font-semibold tabular-nums {badgeStyle}"
			>
				{percent}%
			</span>
		</div>
		<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
			<div
				class="h-full rounded-full {barColor} transition-all duration-300"
				style="width: {percent}%"
			></div>
		</div>
	</div>
{/if}
