<script lang="ts">
	import { isBannerVisible, useSystemBanner } from '$lib/features/shared';
	import SystemBanner from './system-banner.svelte';

	const bannerQuery = useSystemBanner();
	const banner = $derived(bannerQuery.data);
	const visible = $derived(
		!!banner && isBannerVisible({ banner_enabled: banner.enabled, banner_message: banner.message })
	);

	// Reserve space for the fixed banner (see `--testing-banner-height` in app.css).
	$effect(() => {
		const root = document.documentElement;
		root.toggleAttribute('data-system-banner', visible);
		return () => root.removeAttribute('data-system-banner');
	});
</script>

{#if banner && visible}
	<SystemBanner message={banner.message} variant={banner.variant} />
{/if}
