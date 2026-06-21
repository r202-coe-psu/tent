<script lang="ts">
	import { useStockBalance, ReceiveStockForm, LedgerTable } from '$lib/features/operations';
	import { useSupplyItems } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import Package from '@lucide/svelte/icons/package';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Database from '@lucide/svelte/icons/database';

	const balanceQuery = useStockBalance();
	const itemsQuery = useSupplyItems();

	const balance = $derived(balanceQuery.data ?? new Map<string, number>());
	const items = $derived(itemsQuery.data ?? []);
	const isOffline = $derived(authStore.needsReauth);
</script>

<svelte:head>
	<title>คลังสินค้าและสิ่งของบรรเทาทุกข์ · SmartShelter</title>
</svelte:head>

<header class="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-card px-4 py-2.5">
	<Package class="h-4 w-4 text-primary" />
	<h1 class="text-base font-bold text-foreground">คลังสินค้าและสิ่งของบรรเทาทุกข์</h1>
</header>

<div class="flex w-full flex-1 flex-col gap-4 p-4">
	<!-- Offline banner -->
	{#if isOffline}
		<div
			class="flex items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 shadow-sm"
		>
			<AlertTriangle class="h-4 w-4 shrink-0 text-yellow-600" />
			<div>
				<span class="font-bold">Offline Mode:</span>
				ระบบกำลังทำงานในโหมดออฟไลน์ ข้อมูลสต็อกจะถูกบันทึกไว้ในเครื่องก่อน และทำการซิงค์อัตโนมัติเมื่อสัญญาณอินเทอร์เน็ตกลับมาใช้งานได้ปกติ
			</div>
		</div>
	{/if}

	<!-- Stock balance cards row -->
	<div class="space-y-2">
		<div class="flex items-center gap-2">
			<Database class="h-4 w-4 text-primary" />
			<h2 class="text-sm font-bold text-foreground">ยอดคงเหลือสินค้าในคลังประจำศูนย์พักพิง</h2>
		</div>

		{#if itemsQuery.isLoading || balanceQuery.isLoading}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
				{#each [0, 1, 2, 3, 4, 5] as i (i)}
					<div class="h-20 animate-pulse rounded-xl border border-border bg-muted/30"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="text-xs text-muted-foreground">ไม่มีข้อมูลรายการสิ่งของในคลังระบบกลาง</p>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
				{#each items as item (item._id)}
					{@const qty = balance.get(item._id) ?? 0}
					{@const isLowStock = item.reorder_level !== null && qty <= item.reorder_level}
					<div
						class="flex flex-col justify-between rounded-xl border border-border bg-card p-3 shadow-sm transition hover:shadow-md"
					>
						<div>
							<span class="text-[10px] font-bold tracking-wider text-muted-foreground uppercase"
								>{item.category}</span
							>
							<p class="mt-0.5 truncate text-xs font-bold text-foreground">{item.name}</p>
						</div>
						<div class="mt-2 flex items-baseline justify-between">
							<p class="text-xl font-bold text-foreground">
								{qty.toLocaleString()}
								<span class="text-[10px] font-normal text-muted-foreground"> {item.unit}</span>
							</p>
							{#if isLowStock}
								<span
									class="shrink-0 rounded border border-rose-100 bg-rose-50 px-1 py-0.5 text-[9px] font-bold text-rose-700"
								>
									ขาดแคลน
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Form and Ledger log split layout -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
		<!-- Left side: receive stock form -->
		<div class="lg:col-span-5 xl:col-span-4">
			<ReceiveStockForm />
		</div>

		<!-- Right side: history table -->
		<div class="lg:col-span-7 xl:col-span-8">
			<LedgerTable />
		</div>
	</div>
</div>
