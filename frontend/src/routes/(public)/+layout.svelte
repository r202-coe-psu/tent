<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import PublicNavbar from '$lib/components/public-navbar.svelte';
	import PublicFooter from '$lib/components/public-footer.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children?: Snippet } = $props();
	// `/shelters` is one full viewport (#1419): the map fills the screen, so no footer under it.
	const isShelterSearch = $derived(
		page.url.pathname === '/shelters' || page.url.pathname === '/shelters/'
	);
	const isVolunteerPortal = $derived(
		page.url.pathname === '/volunteer/portal' ||
			page.url.pathname === '/volunteers/portal' ||
			page.url.pathname.startsWith('/volunteers/portal/')
	);
</script>

{#if isVolunteerPortal}
	{@render children?.()}
{:else}
	<!-- Keep the public registration form below the sticky navbar chrome. -->
	<div
		class="flex min-h-svh flex-col bg-muted/30 pb-[var(--testing-banner-height)] text-foreground antialiased"
		style="--registration-sticky-top: 4rem"
	>
		<PublicNavbar announcements={data.announcements} />
		<main class="flex-1">
			{@render children?.()}
		</main>
		{#if !isShelterSearch}
			<PublicFooter configData={data.configData} />
		{/if}
	</div>
{/if}
