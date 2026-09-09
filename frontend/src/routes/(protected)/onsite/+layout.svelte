<script lang="ts">
	import type { LayoutProps } from './$types';
	import ShelterNavbar from '$lib/components/shelter-navbar.svelte';
	let { children }: LayoutProps = $props();
</script>

<!--
	--registration-sticky-top: protected app bar (3.5rem / top-14) + ShelterNavbar (52px)
	so UnifiedRegistrationForm sticky chrome clears both bars identically on every onsite page.
-->
<div
	class="flex w-full flex-1 flex-col items-stretch bg-muted/30 text-foreground"
	style="--registration-sticky-top: 6.75rem"
>
	<div class="sticky top-14 z-30">
		<ShelterNavbar />
	</div>
	<div class="w-full flex-1 flex-col">
		{@render children()}
	</div>
</div>
