<script lang="ts">
	import type { LayoutProps } from './$types';
	import ShelterNavbar from '$lib/components/shelter-navbar.svelte';
	let { children }: LayoutProps = $props();
</script>

<div class="flex w-full flex-1 flex-col items-stretch bg-muted/30 text-foreground">
	<div class="sticky top-14 z-30">
		<ShelterNavbar />
	</div>
	<div class="w-full flex-1 flex-col">
		{@render children()}
	</div>
</div>
