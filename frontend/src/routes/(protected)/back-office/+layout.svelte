<script lang="ts">
	import BackofficeNavbar from '$lib/components/backoffice-navbar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="flex h-svh w-full overflow-hidden bg-muted/30 text-foreground">
	<BackofficeNavbar />
	<div class="flex h-full w-full flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>
