<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import UnifiedRegistrationForm from '../unified-registration-form.svelte';

	let {
		client,
		...props
	}: { client: QueryClient } & ComponentProps<typeof UnifiedRegistrationForm> = $props();
</script>

<QueryClientProvider {client}>
	<UnifiedRegistrationForm {...props} />
</QueryClientProvider>
