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
	import Scale from '@lucide/svelte/icons/scale';
	import { ResourceDashboard } from '$lib/features/sop-ratios/components';
	import { shelterCodeFromRoles } from '$lib/auth/roles';

	// ─── Queries ──────────────────────────────────────────────────────────────
	const balanceQuery = useStockBalance();
	const itemsQuery = useSupplyItems();
	const ledgerQuery = useLedger();

	// ─── Derived data ─────────────────────────────────────────────────────────
	const balance = $derived(balanceQuery.data ?? new Map<string, string>());
	const items = $derived(itemsQuery.data ?? []);
	const ledger = $derived(ledgerQuery.data ?? []);

	const roles = $derived(authStore.user?.roles ?? []);
	const shelterCode = $derived(shelterCodeFromRoles(roles));

	// ─── Active Tab State ─────────────────────────────────────────────────────
	let activeTab = $state<'inventory' | 'sphere'>('inventory');

	// ─── Modal state ──────────────────────────────────────────────────────────
	let isReceiveModalOpen = $state(false);

	// ─── KPI Calculations ─────────────────────────────────────────────────────
	const totalItems = $derived(items.length);

	const emptyCount = $derived.by(() => {
		return items.filter((i) => qtyLte(balance.get(i._id) ?? '0', 0)).length;
	});

	const lowStockCount = $derived.by(() => {
		return items.filter((i) => {
			const qty = balance.get(i._id) ?? '0';
			return qtyGt(qty, 0) && i.reorder_level !== null && qtyLte(qty, i.reorder_level);
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
	<!-- Offline banner -->
	{#if isOffline}
		<div
			class="flex animate-pulse items-center gap-3 rounded-2xl border border-yellow-300/40 bg-yellow-500/10 px-4 py-3.5 text-sm text-yellow-800 shadow-sm dark:text-yellow-200"
		>
			<AlertTriangle class="h-5 w-5 shrink-0 text-yellow-500" />
			<div>
				<span class="font-bold">Offline Mode:</span>
				ระบบกำลังทำงานในโหมดออฟไลน์ ข้อมูลสต็อกจะถูกบันทึกไว้ในเครื่องก่อน และทำการซิงค์อัตโนมัติเมื่อสัญญาณอินเทอร์เน็ตกลับมาใช้งานได้ปกติ
			</div>
		</div>
	{/if}

	<!-- Title with Accent Line -->
	<div class="flex items-center gap-3 border-l-4 border-orange-500 pl-3">
		<h2 class="text-xl font-bold text-foreground">คลังทรัพยากร (Stock & Donations)</h2>
	</div>

	<!-- Segmented Tabs (Pills Control) -->
	<div class="flex">
		<div class="inline-flex rounded-xl border border-border/40 bg-muted/60 p-1 shadow-sm">
			<button
				onclick={() => (activeTab = 'inventory')}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] md:px-5 md:py-2.5 {activeTab ===
				'inventory'
					? 'border border-border/60 bg-background text-primary shadow-sm'
					: 'border border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Boxes class="h-4 w-4" />
				รายการพัสดุในคลัง (Stock Inventory)
			</button>
			<button
				onclick={() => (activeTab = 'sphere')}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] md:px-5 md:py-2.5 {activeTab ===
				'sphere'
					? 'border border-border/60 bg-background text-primary shadow-sm'
					: 'border border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Scale class="h-4 w-4" />
				วิเคราะห์ความต้องการเสบียง (Sphere Standard)
			</button>
		</div>
	</div>

	<!-- Dynamic Tab Content -->
	{#if activeTab === 'inventory'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<StockTable />
		</div>
	{:else if activeTab === 'sphere'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<ResourceDashboard {shelterCode} />
		</div>
	{/if}
</div>
