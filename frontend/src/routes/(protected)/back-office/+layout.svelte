<script lang="ts">
	import BackofficeNavbar from '$lib/components/backoffice-navbar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="flex min-h-0 w-full flex-1 items-stretch overflow-hidden bg-muted/30 text-foreground">
	<BackofficeNavbar />
	<div class="min-h-0 w-full flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>
