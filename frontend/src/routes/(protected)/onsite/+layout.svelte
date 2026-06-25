<script lang="ts">
	import type { LayoutProps } from './$types';
	import ShelterNavbar from '$lib/components/shelter-navbar.svelte';
	let { children }: LayoutProps = $props();
</script>

<div class="flex min-h-0 w-full flex-1 flex-col items-stretch overflow-hidden bg-muted/30 text-foreground">
	<ShelterNavbar />
	<div class="min-h-0 w-full flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>
