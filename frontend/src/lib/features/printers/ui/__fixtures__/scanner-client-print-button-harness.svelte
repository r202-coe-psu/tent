<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import ScannerClientPrintButton from '../scanner-client-print-button.svelte';

	let {
		client,
		...props
	}: { client: QueryClient } & ComponentProps<typeof ScannerClientPrintButton> = $props();
	let printing = $state(false);
</script>

<QueryClientProvider {client}>
	<ScannerClientPrintButton {...props} bind:printing />
	<output data-testid="printing">{printing}</output>
</QueryClientProvider>
