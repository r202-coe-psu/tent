<script lang="ts">
	import type { Snippet } from 'svelte';
	import PublicNavbar from '$lib/components/public-navbar.svelte';
	import PublicFooter from '$lib/components/public-footer.svelte';

	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children?: Snippet } = $props();
</script>

<!--
	--registration-sticky-top: PublicNavbar sticky height (~4rem) so pre-register
	UnifiedRegistrationForm sticky chrome matches onsite behavior via the same CSS var.
-->
<div
	class="flex min-h-svh flex-col bg-muted/30 pb-[var(--testing-banner-height)] text-foreground antialiased"
	style="--registration-sticky-top: 4rem"
>
	<PublicNavbar announcements={data.announcements} />
	<main class="flex-1">
		{@render children?.()}
	</main>
	<PublicFooter />
</div>
