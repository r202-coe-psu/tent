<script lang="ts">
	import { StockTable } from '$lib/features/operations';
	import { authStore } from '$lib/stores/auth.svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Scale from '@lucide/svelte/icons/scale';
	import Utensils from '@lucide/svelte/icons/utensils';
	import { FoodSphereStockTab } from '$lib/features/sop-ratios/components';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { shelterCodeFromRoles } from '$lib/auth/roles';
	import { useDashboardOccupancy } from '$lib/features/dashboard';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getShelterCode } from '$lib/db/shelter';

	// ─── Derived data ─────────────────────────────────────────────────────────
	const isOffline = $derived(authStore.needsReauth);

	const roles = $derived(authStore.user?.roles ?? []);
	const shelterCode = $derived(
		shelterStore.selectedShelterCode ?? shelterCodeFromRoles(roles) ?? getShelterCode()
	);

	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const occupancy = $derived(occupancyQuery.data?.active ?? 0);

	type TabKey = 'inventory' | 'sphere' | 'food-sphere';
	const activeTab = $derived<TabKey>(
		page.url.searchParams.get('tab') === 'food-sphere'
			? 'food-sphere'
			: page.url.searchParams.get('tab') === 'sphere'
				? 'sphere'
				: 'inventory'
	);

	function setTab(tab: TabKey) {
		const url = new URL(page.url);
		url.searchParams.set('tab', tab);
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<svelte:head>
	<title>คลังสินค้าและสิ่งของบรรเทาทุกข์ · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-4 bg-background p-3.5 sm:gap-6 sm:p-6">
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
	<div class="flex items-center gap-3 border-l-4 border-primary pl-3">
		<h2 class="text-xl font-bold text-foreground">คลังทรัพยากร (Stock &amp; Donations)</h2>
	</div>

	<!-- Segmented Tabs (Pills Control) -->
	<div class="flex w-full scrollbar-none overflow-x-auto pb-1 sm:pb-0">
		<div class="inline-flex min-w-max rounded-xl border border-border/40 bg-muted/60 p-1 shadow-sm">
			<button
				onclick={() => setTab('inventory')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] md:px-5 md:py-2.5 {activeTab ===
				'inventory'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'border border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Boxes class="h-4 w-4" />
				รายการพัสดุในคลัง
			</button>
			<button
				onclick={() => setTab('sphere')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] md:px-5 md:py-2.5 {activeTab ===
				'sphere'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'border border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Scale class="h-4 w-4" />
				วิเคราะห์ความต้องการพื้นฐาน
			</button>
			<button
				onclick={() => setTab('food-sphere')}
				class="flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] md:px-5 md:py-2.5 {activeTab ===
				'food-sphere'
					? 'border border-border/60 bg-background text-primary shadow-sm'
					: 'border border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Utensils class="h-4 w-4" />
				วิเคราะห์เสบียงอาหาร
			</button>
		</div>
	</div>

	<!-- Dynamic Tab Content -->
	{#if activeTab === 'inventory'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<StockTable {occupancy} />
		</div>
	{:else if activeTab === 'sphere'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<ResourceNeedsDashboard />
		</div>
	{:else if activeTab === 'food-sphere'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<FoodSphereStockTab {occupancy} {shelterCode} />
		</div>
	{/if}
</div>
