<script lang="ts">
	import type { CountryBreakdown } from '$lib/features/dashboard';
	import { getCountryName } from '$lib/utils/country';

	let { data }: { data: CountryBreakdown } = $props();

	const total = $derived(Object.values(data).reduce((sum, count) => sum + count, 0));

	// แปลงเป็น array และเรียงลำดับจากมากไปน้อย (Top 5)
	const topCountries = $derived(
		(Object.entries(data) as [string, number][])
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
	);
</script>

<div class="flex flex-col gap-4">
	{#each topCountries as [countryCode, count] (countryCode)}
		{@const ratio = total > 0 ? (count / total) * 100 : 0}
		<div class="flex flex-col gap-1.5">
			<div class="flex justify-between text-sm">
				<span class="font-medium text-foreground">
					{countryCode === 'UNKNOWN' ? 'ไม่ระบุ' : getCountryName(countryCode)}
				</span>
				<span class="text-muted-foreground">{count} คน ({ratio.toFixed(1)}%)</span>
			</div>
			<!-- Progress Bar -->
			<div class="h-2 w-full overflow-hidden rounded-full bg-secondary">
				<div class="h-full bg-primary" style="width: {ratio}%"></div>
			</div>
		</div>
	{/each}
</div>
