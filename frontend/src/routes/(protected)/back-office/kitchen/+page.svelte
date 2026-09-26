<script lang="ts">
	import { MealSessionList, startKitchenLiveQuery } from '$lib/features/kitchen';
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { useQueryClient } from '@tanstack/svelte-query';

	const queryClient = useQueryClient();

	$effect(() => {
		const kitchen = startKitchenLiveQuery(queryClient);
		// Requisitions deduct stock via stock_ledger — keep on-hand balances live
		// so the requisition dialog and history reflect the current stock.
		const operations = startOperationsLiveQuery(queryClient);
		return () => {
			kitchen.stop();
			operations.stop();
		};
	});
</script>

<svelte:head>
	<title>ครัวกลางและอาหาร · SmartShelter</title>
</svelte:head>

<div class="flex-1">
	<MealSessionList />
</div>
