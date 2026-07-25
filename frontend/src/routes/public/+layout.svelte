<script lang="ts">
	import PublicNavbar from '$lib/components/public-navbar.svelte';
	import PublicFooter from '$lib/components/public-footer.svelte';

	let { children } = $props();
</script>

<div
	class="flex min-h-svh flex-col bg-muted/30 pb-[var(--testing-banner-height)] text-foreground antialiased"
>
	<PublicNavbar />
	<main class="flex-1">
		{@render children?.()}
	</main>
	<PublicFooter />
</div>
