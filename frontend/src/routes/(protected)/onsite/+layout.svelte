<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import ShelterNavbar from '$lib/components/shelter-navbar.svelte';
	import { resolveOnsiteStation } from '$lib/features/portal';
	import { colors } from '$lib/tokens';

	let { children }: LayoutProps = $props();

	const station = $derived(resolveOnsiteStation(page.url.pathname));
	const tone = $derived(station ? colors.station[station.id] : null);
</script>

<!--
	--registration-sticky-top: ShelterNavbar + station band when the page is a station
	(h-[52px] = 3.25rem, band = 2.25rem). Protected app bar is hidden on /onsite.
	Keep in sync if either height changes.
-->
<div
	class="flex w-full flex-1 flex-col items-stretch text-foreground {tone
		? tone.canvas
		: 'bg-muted/30'}"
	style="--registration-sticky-top: {station ? '5.5rem' : '3.25rem'}"
>
	<!-- z-40: above registration sticky chrome (spy nav z-30) so chips never cover the shelter bar -->
	<div class="sticky top-0 z-40">
		<ShelterNavbar />
		{#if station && tone}
			<div
				class="flex h-9 items-center justify-center gap-2 px-4 text-sm font-bold tracking-wide {tone.band}"
			>
				<span class="tabular-nums">สถานี {station.id}</span>
				<span aria-hidden="true" class="opacity-60">·</span>
				<span class="truncate">{tone.name}</span>
			</div>
		{/if}
	</div>
	<div class="w-full flex-1 flex-col">
		{@render children()}
	</div>
</div>
