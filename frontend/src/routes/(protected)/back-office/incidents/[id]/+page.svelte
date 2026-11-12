<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { useQueryClient } from '@tanstack/svelte-query';
	import BackLink from '$lib/components/back-link.svelte';
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
		<BackLink
			href={resolve('/back-office/incidents')}
			label="กลับไปบันทึกเหตุการณ์ประจำวัน"
			class="shrink-0 rounded-xl"
		/>
	</div>

	{#key id}
		<IncidentDetail {shelterCode} {id} />
	{/key}
</div>
