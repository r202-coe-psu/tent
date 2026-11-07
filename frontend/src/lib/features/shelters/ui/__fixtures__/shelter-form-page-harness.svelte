<script lang="ts">
	import { QueryClientProvider, type QueryClient } from '@tanstack/svelte-query';
	import ShelterFormPage from '../shelter-form-page.svelte';

	/** Test-only parent: gives the real edit page the query client the test drives. */
	let { client, code }: { client: QueryClient; code: string } = $props();
</script>

<QueryClientProvider {client}>
	<ShelterFormPage id={code} isEdit={true} basePath="/back-office/shelters" />
</QueryClientProvider>
