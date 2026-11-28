<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import PublicJobBoard from '../public-job-board.svelte';

	let { client, ...props }: { client: QueryClient } & ComponentProps<typeof PublicJobBoard> =
		$props();
</script>

<QueryClientProvider {client}>
	<PublicJobBoard {...props} />
</QueryClientProvider>
