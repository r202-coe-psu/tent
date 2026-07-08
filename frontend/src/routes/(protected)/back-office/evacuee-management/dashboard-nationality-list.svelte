<script lang="ts">
	import type { CountryBreakdown } from '$lib/features/dashboard';
	import { getCountryName } from '$lib/utils/country';

	import { Input } from '$lib/components/ui/input';
	import Search from '@lucide/svelte/icons/search';

	let {
		data,
		limit = 8,
		enableSearch = false,
		class: className = ''
	}: {
		data: CountryBreakdown;
		limit?: number | null;
		enableSearch?: boolean;
		class?: string;
	} = $props();

	let searchQuery = $state('');

	const total = $derived(Object.values(data).reduce((sum, count) => sum + count, 0));

	const sortedCountries = $derived(
		(Object.entries(data) as [string, number][]).sort((a, b) => b[1] - a[1])
	);

	const displayCountries = $derived.by(() => {
		let list = sortedCountries;
		if (enableSearch && searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(([code]) => {
				const localized = code === 'UNKNOWN' ? 'ไม่ระบุ' : getCountryName(code);
				return localized.toLowerCase().includes(q) || code.toLowerCase().includes(q);
			});
		}
		return limit !== null ? list.slice(0, limit) : list;
	});
</script>

<div class="flex flex-col gap-4">
	{#if enableSearch}
		<div class="relative">
			<Search class="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
			<Input type="search" placeholder="ค้นหาประเทศ..." class="pl-9" bind:value={searchQuery} />
		</div>
	{/if}

	<div class="flex flex-col gap-4 {className}">
		{#each displayCountries as [countryCode, count] (countryCode)}
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
		{:else}
			{#if enableSearch && searchQuery.trim()}
				<div class="text-center text-sm text-muted-foreground py-4">ไม่พบประเทศที่ค้นหา</div>
			{/if}
		{/each}
	</div>
</div>
