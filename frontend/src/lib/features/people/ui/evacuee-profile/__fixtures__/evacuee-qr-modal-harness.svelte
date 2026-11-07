<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import EvacueeQrModal from '../evacuee-qr-modal.svelte';

	let { client, ...props }: { client: QueryClient } & ComponentProps<typeof EvacueeQrModal> =
		$props();
</script>

<QueryClientProvider {client}>
	<EvacueeQrModal {...props} />
</QueryClientProvider>
