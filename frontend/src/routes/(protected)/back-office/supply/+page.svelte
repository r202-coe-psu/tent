<script lang="ts">
	import { ReceiveStockForm, StockTable, useStockBalance, useLedger } from '$lib/features/operations';
	import { useSupplyItems } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import Package from '@lucide/svelte/icons/package';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Boxes from '@lucide/svelte/icons/boxes';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Clock from '@lucide/svelte/icons/clock';
	import Activity from '@lucide/svelte/icons/activity';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import XCircle from '@lucide/svelte/icons/x-circle';

	// ─── Queries ──────────────────────────────────────────────────────────────
	const balanceQuery = useStockBalance();
	const itemsQuery = useSupplyItems();
	const ledgerQuery = useLedger();

	// ─── Derived data ─────────────────────────────────────────────────────────
	const balance = $derived(balanceQuery.data ?? new Map<string, number>());
	const items = $derived(itemsQuery.data ?? []);
	const ledger = $derived(ledgerQuery.data ?? []);
	const isOffline = $derived(authStore.needsReauth);

	// ─── Modal state ──────────────────────────────────────────────────────────
	let isReceiveModalOpen = $state(false);

	// ─── KPI Calculations ─────────────────────────────────────────────────────
	const totalItems = $derived(items.length);
	
	const emptyCount = $derived(() => {
		return items.filter((i) => (balance.get(i._id) ?? 0) <= 0).length;
	});

	const lowStockCount = $derived(() => {
		return items.filter((i) => {
			const qty = balance.get(i._id) ?? 0;
			return qty > 0 && i.reorder_level !== null && qty <= i.reorder_level;
		}).length;
	});

	const recentActivityCount = $derived(() => {
		// Filter movements recorded today (last 24 hours)
		const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
		return ledger.filter(entry => Date.parse(entry.occurred_at) > oneDayAgo).length;
	});
</script>

<svelte:head>
	<title>คลังสินค้าและสิ่งของบรรเทาทุกข์ · SmartShelter</title>
</svelte:head>

<!-- Top bar header -->
<header class="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-card px-4 py-2.5">
	<Package class="h-4 w-4 text-primary" />
	<h1 class="text-base font-bold text-foreground">คลังสินค้าและสิ่งของบรรเทาทุกข์</h1>
</header>

<div class="flex w-full flex-1 flex-col gap-6 p-6 bg-background">
	<!-- Offline banner -->
	{#if isOffline}
		<div
			class="flex items-center gap-3 rounded-2xl border border-yellow-300/40 bg-yellow-500/10 px-4 py-3.5 text-sm text-yellow-800 dark:text-yellow-200 shadow-sm animate-pulse"
		>
			<AlertTriangle class="h-5 w-5 shrink-0 text-yellow-500" />
			<div>
				<span class="font-bold">Offline Mode:</span>
				ระบบกำลังทำงานในโหมดออฟไลน์ ข้อมูลสต็อกจะถูกบันทึกไว้ในเครื่องก่อน และทำการซิงค์อัตโนมัติเมื่อสัญญาณอินเทอร์เน็ตกลับมาใช้งานได้ปกติ
			</div>
		</div>
	{/if}

	<!-- Title & Inbound Trigger Button -->
	<div class="flex flex-col sm:flex-row w-full justify-between items-start sm:items-center gap-4">
		<div>
			<h2 class="text-3xl font-extrabold text-foreground tracking-tight flex items-center gap-2">
				<Boxes class="h-8 w-8 text-primary" />
				แผงควบคุมคลังและเสบียง
			</h2>
			<p class="text-muted-foreground mt-1.5 text-sm">
				จัดการรับพัสดุเข้าคลัง ค้นหาสินค้า และเรียกตรวจสอบบัญชีความเคลื่อนไหวสินค้าทั้งหมดในศูนย์พักพิง
			</p>
		</div>

		<!-- Dialog to Receive Stock -->
		<Dialog.Root bind:open={isReceiveModalOpen}>
			<Dialog.Trigger
				class="inline-flex w-full sm:w-auto shrink-0 items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/95 px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] cursor-pointer"
			>
				<PackagePlus class="h-4.5 w-4.5" /> รับของเข้าคลัง
			</Dialog.Trigger>
			<Dialog.Content class="max-h-[90vh] max-w-2xl sm:max-w-2xl overflow-y-auto rounded-[24px] border border-border bg-card shadow-2xl p-6">
				<Dialog.Header class="border-b border-border/60 pb-4 mb-4">
					<Dialog.Title class="text-xl font-bold text-foreground flex items-center gap-2">
						<PackagePlus class="h-5 w-5 text-primary" />
						ลงทะเบียนรับของเข้าคลัง (Check-in)
					</Dialog.Title>
					<Dialog.Description class="text-sm text-muted-foreground mt-1">
						บันทึกการรับเข้าสิ่งของพัสดุจากผู้บริจาค การจัดซื้อ หรือการโอนย้าย โดยระบบจะบันทึกลงใน Ledger โดยอัตโนมัติ
					</Dialog.Description>
				</Dialog.Header>
				<div class="mt-2">
					<ReceiveStockForm
						onsuccess={() => {
							isReceiveModalOpen = false;
						}}
					/>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<!-- KPI Summary Widgets (Depth Design) -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<!-- Total items card -->
		<div class="bg-card/70 border border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 bg-gradient-to-br from-primary/5 via-background to-card flex items-center justify-between">
			<div>
				<span class="text-xs text-muted-foreground font-bold uppercase tracking-wider block">รายการสิ่งของทั้งหมด</span>
				<strong class="text-3xl font-extrabold text-foreground mt-1.5 block font-mono">
					{totalItems.toLocaleString()}
				</strong>
			</div>
			<div class="bg-primary/10 p-3 rounded-xl border border-primary/20 text-primary">
				<Boxes class="h-5 w-5" />
			</div>
		</div>

		<!-- Out of stock card -->
		<div class="bg-card/70 border border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 bg-gradient-to-br from-rose-500/5 via-background to-card flex items-center justify-between">
			<div>
				<span class="text-xs text-muted-foreground font-bold uppercase tracking-wider block">สินค้าหมดคลัง</span>
				<strong class="text-3xl font-extrabold mt-1.5 block font-mono {emptyCount() > 0 ? 'text-rose-600' : 'text-foreground'}">
					{emptyCount().toLocaleString()}
				</strong>
			</div>
			<div class="p-3 rounded-xl border flex items-center justify-center {emptyCount() > 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-600' : 'bg-muted border-border text-muted-foreground'}">
				<XCircle class="h-5 w-5" />
			</div>
		</div>

		<!-- Low stock card -->
		<div class="bg-card/70 border border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 bg-gradient-to-br from-amber-500/5 via-background to-card flex items-center justify-between">
			<div>
				<span class="text-xs text-muted-foreground font-bold uppercase tracking-wider block">สินค้าใกล้หมด (เฝ้าระวัง)</span>
				<strong class="text-3xl font-extrabold mt-1.5 block font-mono {lowStockCount() > 0 ? 'text-amber-600' : 'text-foreground'}">
					{lowStockCount().toLocaleString()}
				</strong>
			</div>
			<div class="p-3 rounded-xl border flex items-center justify-center {lowStockCount() > 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-600' : 'bg-muted border-border text-muted-foreground'}">
				<AlertTriangle class="h-5 w-5" />
			</div>
		</div>

		<!-- Transactions count card -->
		<div class="bg-card/70 border border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 bg-gradient-to-br from-purple-500/5 via-background to-card flex items-center justify-between">
			<div>
				<span class="text-xs text-muted-foreground font-bold uppercase tracking-wider block">ความเคลื่อนไหวใน 24 ชม.</span>
				<strong class="text-3xl font-extrabold text-foreground mt-1.5 block font-mono">
					{recentActivityCount().toLocaleString()}
				</strong>
			</div>
			<div class="bg-purple-500/10 p-3 rounded-xl border border-purple-500/20 text-purple-600 dark:text-purple-400">
				<TrendingUp class="h-5 w-5" />
			</div>
		</div>
	</div>

	<!-- Main Inventory Table -->
	<div class="animate-in duration-300 fade-in slide-in-from-bottom-3">
		<StockTable />
	</div>
</div>
