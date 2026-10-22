<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import PrintLabelsButton from '../print-labels-button.svelte';

	let { client, ...props }: { client: QueryClient } & ComponentProps<typeof PrintLabelsButton> =
		$props();
</script>

<QueryClientProvider {client}>
	<PrintLabelsButton {...props} />
</QueryClientProvider>
