<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { afterNavigate } from '$app/navigation';
	import { asset } from '$app/paths';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { PUBLIC_APP_TITLE } from '$env/static/public';
	import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';
	import TestingBanner from '$lib/components/testing-banner.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { scrollAppToTop } from '$lib/utils/scroll-app-to-top';

	let { children, data } = $props();

	$effect(() => {
		if (authStore.isAuthenticated) return;
		data.queryClient.clear();
	});

	// Nested overflow shells (onsite / back-office / portal) own scroll — reset them
	// on every client navigation. Skip when a hash is present so in-page anchors work.
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
	<SvelteQueryDevtools />
</QueryClientProvider>
