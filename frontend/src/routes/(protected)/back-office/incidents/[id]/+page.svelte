<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { useQueryClient } from '@tanstack/svelte-query';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/components/ui/button/index.js';
	import { IncidentDetail, startIncidentLiveQuery } from '$lib/features/incidents';
	import { getShelterCode } from '$lib/db/shelter';

	const queryClient = useQueryClient();
	const shelterCode = $derived(getShelterCode());
	const id = $derived(page.params.id ?? '');

	// Reactivity comes from the shelter DB changes feed — never poll.
	$effect(() => {
		const handle = startIncidentLiveQuery(queryClient);
		return () => handle.stop();
	});
</script>

<svelte:head>
	<title>รายละเอียดเหตุการณ์ | SmartShelter Thailand</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button
			variant="outline"
			href={resolve('/back-office/incidents')}
			class="min-h-11 shrink-0 gap-1.5 rounded-xl"
		>
			<ArrowLeft class="h-4 w-4" />
			ย้อนกลับไปรายการเหตุการณ์
		</Button>
	</div>

	{#key id}
		<IncidentDetail {shelterCode} {id} />
	{/key}
</div>
