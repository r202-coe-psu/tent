<script lang="ts">
	import {
		ReceiveStockForm,
		StockTable,
		useStockBalance,
		useLedger
	} from '$lib/features/operations';
	import { useSupplyItems } from '$lib/features/supply';
	import * as Dialog from '$lib/components/ui/dialog';
	import Package from '@lucide/svelte/icons/package';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Boxes from '@lucide/svelte/icons/boxes';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
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

	// ─── Modal state ──────────────────────────────────────────────────────────
	let isReceiveModalOpen = $state(false);

	// ─── KPI Calculations ─────────────────────────────────────────────────────
	const totalItems = $derived(items.length);

	const emptyCount = $derived.by(() => {
		return items.filter((i) => (balance.get(i._id) ?? 0) <= 0).length;
	});

	const lowStockCount = $derived.by(() => {
		return items.filter((i) => {
			const qty = balance.get(i._id) ?? 0;
			return qty > 0 && i.reorder_level !== null && qty <= i.reorder_level;
		}).length;
	});

	const recentActivityCount = $derived.by(() => {
		// Filter movements recorded today (last 24 hours)
		const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
		return ledger.filter((entry) => Date.parse(entry.occurred_at) > oneDayAgo).length;
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

<div class="flex w-full flex-1 flex-col gap-6 bg-background p-6">
	<!-- Title & Inbound Trigger Button -->
	<div class="flex w-full flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<h2 class="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-foreground">
				<Boxes class="h-8 w-8 text-primary" />
				แผงควบคุมคลังและเสบียง
			</h2>
			<p class="mt-1.5 text-sm text-muted-foreground">
				จัดการรับพัสดุเข้าคลัง ค้นหาสินค้า
				และเรียกตรวจสอบบัญชีความเคลื่อนไหวสินค้าทั้งหมดในศูนย์พักพิง
			</p>
		</div>

		<!-- Dialog to Receive Stock -->
		<Dialog.Root bind:open={isReceiveModalOpen}>
			<Dialog.Trigger
				class="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg transition-all duration-300 hover:scale-[1.03] hover:bg-primary/95 hover:shadow-xl active:scale-[0.97] sm:w-auto"
			>
				<PackagePlus class="h-4.5 w-4.5" /> รับของเข้าคลัง
			</Dialog.Trigger>
			<Dialog.Content
				class="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[24px] border border-border bg-card p-6 shadow-2xl sm:max-w-2xl"
			>
				<Dialog.Header class="mb-4 border-b border-border/60 pb-4">
					<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-foreground">
						<PackagePlus class="h-5 w-5 text-primary" />
						ลงทะเบียนรับของเข้าคลัง (Check-in)
					</Dialog.Title>
					<Dialog.Description class="mt-1 text-sm text-muted-foreground">
						บันทึกการรับเข้าสิ่งของพัสดุจากผู้บริจาค การจัดซื้อ หรือการโอนย้าย โดยระบบจะบันทึกลงใน
						Ledger โดยอัตโนมัติ
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
		<div
			class="flex items-center justify-between rounded-2xl border border-border/80 bg-card/70 bg-gradient-to-br from-primary/5 via-background to-card p-5 shadow-sm transition-all duration-300 hover:shadow-md"
		>
			<div>
				<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase"
					>รายการสิ่งของทั้งหมด</span
				>
				<strong class="mt-1.5 block font-mono text-3xl font-extrabold text-foreground">
					{totalItems.toLocaleString()}
				</strong>
			</div>
			<div class="rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary">
				<Boxes class="h-5 w-5" />
			</div>
		</div>

		<!-- Out of stock card -->
		<div
			class="flex items-center justify-between rounded-2xl border border-border/80 bg-card/70 bg-gradient-to-br from-rose-500/5 via-background to-card p-5 shadow-sm transition-all duration-300 hover:shadow-md"
		>
			<div>
				<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase"
					>สินค้าหมดคลัง</span
				>
				<strong
					class="mt-1.5 block font-mono text-3xl font-extrabold {emptyCount > 0
						? 'text-rose-600'
						: 'text-foreground'}"
				>
					{emptyCount.toLocaleString()}
				</strong>
			</div>
			<div
				class="flex items-center justify-center rounded-xl border p-3 {emptyCount > 0
					? 'border-rose-500/20 bg-rose-500/10 text-rose-600'
					: 'border-border bg-muted text-muted-foreground'}"
			>
				<XCircle class="h-5 w-5" />
			</div>
		</div>

		<!-- Low stock card -->
		<div
			class="flex items-center justify-between rounded-2xl border border-border/80 bg-card/70 bg-gradient-to-br from-amber-500/5 via-background to-card p-5 shadow-sm transition-all duration-300 hover:shadow-md"
		>
			<div>
				<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase"
					>สินค้าใกล้หมด (เฝ้าระวัง)</span
				>
				<strong
					class="mt-1.5 block font-mono text-3xl font-extrabold {lowStockCount > 0
						? 'text-amber-600'
						: 'text-foreground'}"
				>
					{lowStockCount.toLocaleString()}
				</strong>
			</div>
			<div
				class="flex items-center justify-center rounded-xl border p-3 {lowStockCount > 0
					? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
					: 'border-border bg-muted text-muted-foreground'}"
			>
				<AlertTriangle class="h-5 w-5" />
			</div>
		</div>

		<!-- Transactions count card -->
		<div
			class="flex items-center justify-between rounded-2xl border border-border/80 bg-card/70 bg-gradient-to-br from-purple-500/5 via-background to-card p-5 shadow-sm transition-all duration-300 hover:shadow-md"
		>
			<div>
				<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase"
					>ความเคลื่อนไหวใน 24 ชม.</span
				>
				<strong class="mt-1.5 block font-mono text-3xl font-extrabold text-foreground">
					{recentActivityCount.toLocaleString()}
				</strong>
			</div>
			<div
				class="rounded-xl border border-purple-500/20 bg-purple-500/10 p-3 text-purple-600 dark:text-purple-400"
			>
				<TrendingUp class="h-5 w-5" />
			</div>
		</div>
	</div>

	<!-- Main Inventory Table -->
	<div class="animate-in duration-300 fade-in slide-in-from-bottom-3">
		<StockTable />
	</div>
</div>
