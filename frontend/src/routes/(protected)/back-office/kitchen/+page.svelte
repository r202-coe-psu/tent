<script lang="ts">
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Flame from '@lucide/svelte/icons/flame';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		MealPlanList,
		RequisitionHistory,
		MealServiceSummary,
		useMealPlans,
		useOccupancyHeadcount,
		useGasCylinderTypes,
		useRequisitions,
		startKitchenLiveQuery
	} from '$lib/features/kitchen';
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { useQueryClient } from '@tanstack/svelte-query';
	import * as Tabs from '$lib/components/ui/tabs';

	const queryClient = useQueryClient();
	const plans = useMealPlans();
	const occupancy = useOccupancyHeadcount();
	const gasTypes = useGasCylinderTypes();
	const requisitions = useRequisitions();

	const stats = $derived.by(() => {
		const all = plans.data ?? [];
		const totalBoxes = all.reduce((sum, p) => sum + p.headcount.total, 0);
		const confirmed = all.filter((p) => p.status === 'confirmed').length;
		const draft = all.filter((p) => p.status === 'draft').length;
		return {
			totalBoxes,
			confirmed,
			draft,
			total: all.length
		};
	});

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
	<div class="p-4 pb-0">
		<Card.Root class="border-0 shadow-sm">
			<Card.Content class="flex flex-wrap items-start justify-between gap-4 pt-4">
				<div class="flex items-start gap-3">
					<div class="rounded-lg bg-primary/10 p-2">
						<UtensilsCrossed class="h-5 w-5 text-primary" />
					</div>
					<div>
						<h2 class="text-base font-bold">ประวัติประกอบโรงครัว (Meal Production Logs)</h2>
						<p class="mt-0.5 text-xs text-muted-foreground">
							บันทึกการวางแผนอาหารและรายการวัตถุดิบที่ต้องเบิกต่อมื้อ
						</p>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
						ผู้พักพิง (LIVE COUNT): {occupancy.data?.total ?? 0} คน
					</span>
					<a
						href={resolve('/back-office/kitchen/gas')}
						class="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 transition-colors hover:bg-orange-200"
						title="จัดการทรัพยากรแก๊ส"
					>
						<Flame class="h-3.5 w-3.5" />
						ถังแก๊ส ({gasTypes.data?.length ?? 0})
					</a>
					<a
						href={resolve('/back-office/catalog')}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
					>
						ฐานสูตร BOM
					</a>
					<span
						class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
					>
						{authStore.user?.name ?? '—'}
					</span>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
	<div class="grid grid-cols-2 gap-3 p-4 pb-0 sm:grid-cols-4">
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">กล่องอาหารสำเร็จรวม</p>
			<p class="mt-1 text-2xl font-bold">{stats.totalBoxes.toLocaleString()}</p>
			<p class="text-xs text-muted-foreground">กล่อง</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">แผนยืนยันแล้ว</p>
			<p class="mt-1 text-2xl font-bold">{stats.confirmed} / {stats.total}</p>
			<p class="text-xs text-muted-foreground">แผน</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">แผนรอดำเนินการ</p>
			<p class="mt-1 text-2xl font-bold">{stats.draft.toLocaleString()}</p>
			<p class="text-xs text-muted-foreground">แผน</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">จำนวนครั้งเบิกวัตถุดิบ</p>
			<p class="mt-1 text-2xl font-bold">{(requisitions.data?.length ?? 0).toLocaleString()}</p>
			<p class="text-xs text-muted-foreground">ครั้ง</p>
		</div>
	</div>
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
