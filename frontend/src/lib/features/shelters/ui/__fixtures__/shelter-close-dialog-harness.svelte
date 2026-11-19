<script lang="ts">
	import { QueryClientProvider, type QueryClient } from '@tanstack/svelte-query';
	import ShelterCloseDialog from '../shelter-close-dialog.svelte';
	import type { ShelterCloseJobView } from '../../domain/shelter-close-job';

	/** Test-only parent: gives the real dialog the query client the test drives. */
	let {
		client,
		resumeJobId = null,
		onfinish,
		oncancel
	}: {
		client: QueryClient;
		resumeJobId?: string | null;
		onfinish?: (view: ShelterCloseJobView) => void;
		oncancel?: () => void;
	} = $props();
	let open = $state(true);
</script>

<QueryClientProvider {client}>
	<ShelterCloseDialog
		bind:open
		code="SH001"
		name="ศูนย์ วัดกลาง"
		{resumeJobId}
		{onfinish}
		{oncancel}
	/>
	<span data-testid="open">{open}</span>
</QueryClientProvider>
