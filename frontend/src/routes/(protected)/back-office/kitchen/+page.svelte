<script lang="ts">
	import {
		MealPlanList,
		RequisitionHistory,
		MealServiceSummary,
		startKitchenLiveQuery
	} from '$lib/features/kitchen';
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { useQueryClient } from '@tanstack/svelte-query';
	import * as Tabs from '$lib/components/ui/tabs';

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

<div class="flex-1 overflow-auto">
	<Tabs.Root value="plan" class="gap-0">
		<Tabs.List class="mx-4 mt-4">
			<Tabs.Trigger value="plan">แผนอาหาร</Tabs.Trigger>
			<Tabs.Trigger value="requisition">ประวัติเบิก</Tabs.Trigger>
			<Tabs.Trigger value="service">สรุปบริการ</Tabs.Trigger>
		</Tabs.List>
		<Tabs.Content value="plan">
			<MealPlanList />
		</Tabs.Content>
		<Tabs.Content value="requisition" class="px-4 pb-4">
			<RequisitionHistory />
		</Tabs.Content>
		<Tabs.Content value="service" class="px-4 pb-4">
			<MealServiceSummary />
		</Tabs.Content>
	</Tabs.Root>
</div>
