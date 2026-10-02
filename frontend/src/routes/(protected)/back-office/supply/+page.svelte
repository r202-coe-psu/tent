<script lang="ts">
	import {
		LEDGER_PARAM_KEYS,
		LedgerTable,
		STOCK_PARAM_KEYS,
		StockTable,
		TransferForm,
		TransferList,
		usePendingTransferCount
	} from '$lib/features/operations';
	import { ProductsPanel } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { ResourceNeedsDashboard } from '$lib/features/resource-calc';
	import { FoodSphereStockTab } from '$lib/features/sop-ratios/components';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { shelterCodeFromRoles } from '$lib/auth/roles';
	import { useDashboardOccupancy } from '$lib/features/dashboard';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getShelterCode } from '$lib/db/shelter';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	const isOffline = $derived(authStore.needsReauth);

	const roles = $derived(authStore.user?.roles ?? []);
	const shelterCode = $derived(
		shelterStore.selectedShelterCode ?? shelterCodeFromRoles(roles) ?? getShelterCode()
	);

	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const occupancy = $derived(occupancyQuery.data?.active ?? 0);

	const pendingTransfers = usePendingTransferCount();
	const pendingCount = $derived(pendingTransfers.data ?? 0);

	const catalogBasePath = resolve('/back-office/catalog');

	const PRIMARY_TABS = ['inventory', 'movements', 'transfer'] as const;
	type PrimaryTabKey = (typeof PRIMARY_TABS)[number];
	// Reached by link, not by tab: their `?tab=` URLs keep working.
	const SECONDARY_TABS = [
		{ key: 'catalog', label: 'สินค้า (Master)' },
		{ key: 'sphere', label: 'วิเคราะห์ความต้องการ' },
		{ key: 'food-sphere', label: 'วิเคราะห์เสบียงอาหาร' }
	] as const;
	type SecondaryTabKey = (typeof SECONDARY_TABS)[number]['key'];
	type TabKey = PrimaryTabKey | SecondaryTabKey;

	const KNOWN_TABS: readonly TabKey[] = [...PRIMARY_TABS, ...SECONDARY_TABS.map((t) => t.key)];

	const activeTab = $derived<TabKey>(
		KNOWN_TABS.find((t) => t === page.url.searchParams.get('tab')) ?? 'inventory'
	);

	function setTab(tab: PrimaryTabKey) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('tab', tab);
		params.delete('action');
		if (tab !== 'inventory') {
			for (const key of STOCK_PARAM_KEYS) params.delete(key);
		}
		if (tab !== 'movements') {
			for (const key of LEDGER_PARAM_KEYS) params.delete(key);
		}
		const qs = params.toString();
		void goto(resolve(`/back-office/supply${qs ? `?${qs}` : ''}` as '/back-office/supply'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function tabClass(active: boolean) {
		return [
			'-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-[3px] px-3.5 text-base transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none md:px-4',
			active
				? 'border-[#0A2647] font-bold text-[#0A2647]'
				: 'border-transparent font-semibold text-slate-600 hover:text-slate-900'
		].join(' ');
	}

	function secondaryClass(active: boolean) {
		return [
			'inline-flex min-h-11 shrink-0 items-center rounded px-1 text-sm font-semibold whitespace-nowrap focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none',
			active ? 'text-[#0A2647] underline underline-offset-4' : 'text-sky-700 hover:text-sky-900'
		].join(' ');
	}
</script>

<svelte:head>
	<title>คลังของศูนย์ · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-4 bg-[#F8FAFC] p-3.5 sm:gap-6 sm:p-6">
	{#if isOffline}
		<div
			class="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-950 shadow-2xs"
		>
			<AlertTriangle class="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
			<div>
				<span class="font-bold">ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์:</span>
				ระบบต้องการการเชื่อมต่อเพื่ออ่านและบันทึกสต็อก กรุณาตรวจสอบเครือข่ายแล้วลองใหม่อีกครั้ง
			</div>
		</div>
	{/if}

	<header class="space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-[#0A2647] sm:text-3xl">คลังของศูนย์</h1>
		<p class="text-base text-slate-600 sm:text-lg">ยอดคงเหลือและเคลื่อนไหวสต็อกของศูนย์นี้</p>
	</header>

	<div
		class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-slate-200"
	>
		<nav
			class="flex min-w-0 scrollbar-none items-center gap-1 overflow-x-auto"
			aria-label="แท็บคลัง"
		>
			<button
				type="button"
				onclick={() => setTab('inventory')}
				aria-current={activeTab === 'inventory' ? 'page' : undefined}
				class={tabClass(activeTab === 'inventory')}
			>
				สต็อก
			</button>
			<button
				type="button"
				onclick={() => setTab('movements')}
				aria-current={activeTab === 'movements' ? 'page' : undefined}
				class={tabClass(activeTab === 'movements')}
			>
				ความเคลื่อนไหว
			</button>
			<button
				type="button"
				onclick={() => setTab('transfer')}
				aria-current={activeTab === 'transfer' ? 'page' : undefined}
				class={tabClass(activeTab === 'transfer')}
			>
				โอนย้าย
				{#if pendingCount > 0}
					<span
						class="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#0284C7] px-1.5 text-xs font-bold text-white tabular-nums"
					>
						{pendingCount}
						<span class="sr-only">รายการรอดำเนินการ</span>
					</span>
				{/if}
			</button>
		</nav>

		<nav
			class="flex min-w-0 scrollbar-none items-center gap-5 overflow-x-auto"
			aria-label="เครื่องมือเพิ่มเติม"
		>
			{#each SECONDARY_TABS as tab (tab.key)}
				<a
					href={resolve(`/back-office/supply?tab=${tab.key}` as '/back-office/supply')}
					aria-current={activeTab === tab.key ? 'page' : undefined}
					class={secondaryClass(activeTab === tab.key)}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>

	{#if activeTab === 'inventory'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<StockTable {occupancy} />
		</div>
	{:else if activeTab === 'movements'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<LedgerTable />
		</div>
	{:else if activeTab === 'catalog'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<ProductsPanel basePath={catalogBasePath} scope="shelter" />
		</div>
	{:else if activeTab === 'sphere'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<ResourceNeedsDashboard />
		</div>
	{:else if activeTab === 'food-sphere'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<FoodSphereStockTab {occupancy} {shelterCode} />
		</div>
	{:else if activeTab === 'transfer'}
		<div class="flex animate-in flex-col gap-6 duration-300 fade-in slide-in-from-bottom-2">
			<TransferForm />
			<TransferList />
		</div>
	{/if}
</div>
