<script lang="ts">
	import { MealPlanList, startKitchenLiveQuery } from '$lib/features/kitchen';
	import { useQueryClient } from '@tanstack/svelte-query';

	const queryClient = useQueryClient();

	$effect(() => {
		const handle = startKitchenLiveQuery(queryClient);
		return () => handle.stop();
	});
</script>

<svelte:head>
	<title>ครัวกลางและอาหาร · SmartShelter</title>
</svelte:head>

<div class="flex-1 overflow-auto">
	<MealPlanList />
</div>
