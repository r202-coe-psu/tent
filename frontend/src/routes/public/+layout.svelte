<script lang="ts">
	import PublicNavbar from '$lib/components/public-navbar.svelte';
	import PublicFooter from '$lib/components/public-footer.svelte';

	let { children } = $props();
</script>

<div class="flex min-h-screen flex-col bg-muted/30 text-foreground antialiased">
	<PublicNavbar />
	<main class="flex-1">
		{@render children?.()}
	</main>
	<PublicFooter />
</div>
