<script lang="ts">
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import { Button } from '$lib/components/ui/button/index.js';
	import { canAccessManagerPages } from '$lib/auth/roles';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';
	import { useConsulateExport, useExportCountries } from '../application/queries';
	import ConsulateExportDialog from './consulate-export-dialog.svelte';

	let { shelterCode, class: className = '' }: { shelterCode: string; class?: string } = $props();

	// FR-2: SA + shelter_manager only — NOT registration_staff.
	const allowed = $derived(canAccessManagerPages(authStore.user?.roles ?? [], shelterCode));

	let open = $state(false);

	const countriesQuery = useExportCountries(
		() => shelterCode,
		() => open && allowed
	);
	const shelterQuery = useShelter(
		() => shelterCode,
		() => allowed
	);
	const vulnerableQuery = useMasterData(() => 'vulnerable_group');
	const exportMutation = useConsulateExport();

	// Zone names and vulnerable-group labels must be loaded, or the file would carry raw codes.
	const lookupsReady = $derived(shelterQuery.isSuccess && vulnerableQuery.isSuccess);

	const lookupsError = $derived(shelterQuery.isError || vulnerableQuery.isError);

	function retryLookups() {
		if (shelterQuery.isError) void shelterQuery.refetch();
		if (vulnerableQuery.isError) void vulnerableQuery.refetch();
	}

	function confirm(country: string) {
		if (!lookupsReady) return;
		exportMutation.mutate(
			{
				shelterCode,
				country,
				author: { shelterCode, createdBy: authStore.user?.name ?? 'staff' },
				roles: authStore.user?.roles ?? [],
				lookups: {
					zones: shelterQuery.data?.zones ?? [],
					vulnerableGroups: vulnerableQuery.data?.items ?? []
				}
			},
			{ onSuccess: () => (open = false) }
		);
	}
</script>

{#if allowed}
	<Button type="button" variant="outline" class="w-full {className}" onclick={() => (open = true)}>
		<FileSpreadsheet class="h-4 w-4" />
		Export รายชื่อสำหรับกงสุล
	</Button>
	<ConsulateExportDialog
		bind:open
		countries={countriesQuery.data ?? []}
		isLoading={countriesQuery.isPending && countriesQuery.fetchStatus !== 'idle'}
		isError={countriesQuery.isError}
		isExporting={exportMutation.isPending}
		{lookupsReady}
		{lookupsError}
		onRetryLookups={retryLookups}
		onConfirm={confirm}
	/>
{/if}
