<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { afterNavigate } from '$app/navigation';
	import { asset } from '$app/paths';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { PUBLIC_APP_TITLE } from '$env/static/public';
	import TestingBanner from '$lib/components/testing-banner.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { scrollAppToTop } from '$lib/utils/scroll-app-to-top';

	let { children, data } = $props();

	/**
	 * Drop cached data when a session ends, so one user's records are not sitting in
	 * memory for whoever logs in next on the same device.
	 *
	 * Only on the transition out of a session. This used to clear whenever nobody was
	 * authenticated, which is every visitor on the public plane — and it ran after the
	 * page's own queries had already started, cancelling them. The query stayed
	 * `pending`/`fetching` forever with its request sitting completed in the network
	 * panel, so any public page whose data loads on first render rendered a skeleton
	 * and nothing else.
	 *
	 * `hadSession` is a plain variable, not `$state`: it is a latch this effect reads
	 * and writes, and nothing renders from it.
	 */
	let hadSession = false;
	$effect(() => {
		if (authStore.isAuthenticated) {
			hadSession = true;
			return;
		}
		if (!hadSession) return;
		hadSession = false;
		data.queryClient.clear();
	});

	// Staff shells use document/window scroll — reset on every client navigation.
	// Skip when a hash is present so in-page anchors work.
	afterNavigate(({ to }) => {
		if (to?.url.hash) return;
		requestAnimationFrame(() => {
			scrollAppToTop();
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="icon" href={asset('/favicon.ico')} sizes="32x32" />
	<link rel="apple-touch-icon" href={asset('/apple-touch-icon.png')} />
	<link rel="manifest" href={asset('/site.webmanifest')} />
	<meta name="theme-color" content="#0A2647" />
	<title>
		{PUBLIC_APP_TITLE}
	</title>
</svelte:head>

<Toaster position="top-center" richColors />

<QueryClientProvider client={data.queryClient}>
	{@render children?.()}
	<TestingBanner />
</QueryClientProvider>
