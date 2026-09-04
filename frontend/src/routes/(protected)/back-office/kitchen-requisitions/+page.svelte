<script lang="ts">
	import { KitchenRequisitionList, startKitchenLiveQuery } from '$lib/features/kitchen';
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { useQueryClient } from '@tanstack/svelte-query';

	const queryClient = useQueryClient();

	$effect(() => {
		const kitchen = startKitchenLiveQuery(queryClient);
		const ops = startOperationsLiveQuery(queryClient);
		return () => {
			kitchen.stop();
			ops.stop();
		};
	});
</script>

<svelte:head>
	<title>คำขอเบิกโรงครัว · SmartShelter</title>
</svelte:head>

<div class="flex-1 overflow-auto">
	<KitchenRequisitionList />
</div>
