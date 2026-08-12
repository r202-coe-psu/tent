<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { PUBLIC_APP_TITLE } from '$env/static/public';
	import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';
	import TestingBanner from '$lib/components/testing-banner.svelte';
	import { authStore } from '$lib/stores/auth.svelte';

	let { children, data } = $props();

	$effect(() => {
		if (authStore.isAuthenticated) return;
		data.queryClient.clear();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
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
