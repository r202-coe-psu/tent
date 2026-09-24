<script lang="ts">
	import type { LayoutProps } from './$types';
	import ShelterNavbar from '$lib/components/shelter-navbar.svelte';
	let { children }: LayoutProps = $props();
</script>

<!--
	--registration-sticky-top: ShelterNavbar only (h-[52px] = 3.25rem).
	Protected app bar is hidden on /onsite. Keep in sync if the bar height changes.
-->
<div
	class="flex w-full flex-1 flex-col items-stretch bg-muted/30 text-foreground"
	style="--registration-sticky-top: 3.25rem"
>
	<!-- z-40: above registration sticky chrome (spy nav z-30) so chips never cover the shelter bar -->
	<div class="sticky top-0 z-40">
		<ShelterNavbar />
	</div>
	<div class="w-full flex-1 flex-col">
		{@render children()}
	</div>
</div>
