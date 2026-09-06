<script lang="ts">
	import { page } from '$app/state';
	import PublicNavbar from '$lib/components/public-navbar.svelte';
	import PublicFooter from '$lib/components/public-footer.svelte';

	let { children } = $props();
	const isVolunteerPortal = $derived(
		page.url.pathname === '/volunteer/portal' ||
			page.url.pathname === '/volunteers/portal' ||
			page.url.pathname.startsWith('/volunteers/portal/')
	);
</script>

{#if isVolunteerPortal}
	{@render children?.()}
{:else}
	<div
		class="flex min-h-svh flex-col bg-muted/30 pb-[var(--testing-banner-height)] text-foreground antialiased"
	>
		<PublicNavbar />
		<main class="flex-1">
			{@render children?.()}
		</main>
		<PublicFooter />
	</div>
{/if}
