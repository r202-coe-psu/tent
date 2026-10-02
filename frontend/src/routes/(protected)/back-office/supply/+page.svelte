<script lang="ts">
	import {
		STOCK_PARAM_KEYS,
		StockTable,
		TransferForm,
		TransferList
	} from '$lib/features/operations';
	import { ProductsPanel } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Scale from '@lucide/svelte/icons/scale';
	import Truck from '@lucide/svelte/icons/truck';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Warehouse from '@lucide/svelte/icons/warehouse';
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
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	const isOffline = $derived(authStore.needsReauth);

	const roles = $derived(authStore.user?.roles ?? []);
	const shelterCode = $derived(
		shelterStore.selectedShelterCode ?? shelterCodeFromRoles(roles) ?? getShelterCode()
	);

	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const occupancy = $derived(occupancyQuery.data?.active ?? 0);

	const catalogBasePath = resolve('/back-office/catalog');

	type TabKey = 'inventory' | 'catalog' | 'sphere' | 'food-sphere' | 'transfer';
	const SECONDARY_TABS = ['catalog', 'sphere', 'food-sphere'] as const;
	type SecondaryTabKey = (typeof SECONDARY_TABS)[number];

	const activeTab = $derived<TabKey>(
		(['catalog', 'sphere', 'food-sphere', 'transfer'] as const).find(
			(t) => t === page.url.searchParams.get('tab')
		) ?? 'inventory'
	);

	const isSecondaryTab = $derived((SECONDARY_TABS as readonly string[]).includes(activeTab));

	const secondaryLabel = $derived.by(() => {
		switch (activeTab) {
			case 'catalog':
				return 'สินค้า (Master)';
			case 'sphere':
				return 'วิเคราะห์ความต้องการพื้นฐาน';
			case 'food-sphere':
				return 'วิเคราะห์เสบียงอาหาร';
			default:
				return 'เครื่องมือเพิ่มเติม';
		}
	});

	function setTab(tab: TabKey) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('tab', tab);
		if (tab !== 'catalog') {
			params.delete('action');
		}
		if (tab !== 'inventory') {
			for (const key of STOCK_PARAM_KEYS) params.delete(key);
		}
		const qs = params.toString();
		void goto(resolve(`/back-office/supply${qs ? `?${qs}` : ''}` as '/back-office/supply'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function primaryPillClass(tab: 'inventory' | 'transfer') {
		const active = activeTab === tab;
		return [
			'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold tracking-wide transition-all duration-200 active:scale-[0.98] md:px-5',
			active
				? 'bg-[#0A2647] text-white shadow-2xs'
				: 'border border-transparent text-slate-500 hover:bg-white/80 hover:text-slate-900'
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
		class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-2xs"
	>
		<nav
			class="flex min-w-0 flex-1 scrollbar-none items-center gap-1 overflow-x-auto"
			aria-label="แท็บหลักคลัง"
		>
			<button
				type="button"
				onclick={() => setTab('inventory')}
				class={primaryPillClass('inventory')}
			>
				<Boxes class="h-4 w-4 shrink-0" aria-hidden="true" />
				<span class="md:hidden">พัสดุ</span>
				<span class="hidden md:inline">รายการพัสดุ</span>
			</button>
			<button type="button" onclick={() => setTab('transfer')} class={primaryPillClass('transfer')}>
				<Truck class="h-4 w-4 shrink-0" aria-hidden="true" />
				<span class="md:hidden">โอน</span>
				<span class="hidden md:inline">โอนข้ามศูนย์</span>
			</button>
		</nav>

		<div class="ms-auto shrink-0">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							class="min-h-11 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 {isSecondaryTab
								? 'border-teal-200 bg-teal-50 text-teal-900'
								: ''}"
						>
							<span class="md:hidden" aria-hidden="true">
								<Ellipsis class="h-4 w-4" />
							</span>
							<span class="hidden max-w-[14rem] truncate md:inline">{secondaryLabel}</span>
							<span class="md:hidden">เพิ่มเติม</span>
							<ChevronDown class="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
							<span class="sr-only">เครื่องมือเพิ่มเติม</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-56">
					<DropdownMenu.Label class="text-xs font-semibold text-slate-500">
						เครื่องมือเพิ่มเติม
					</DropdownMenu.Label>
					<DropdownMenu.Separator />
					<DropdownMenu.RadioGroup
						value={isSecondaryTab ? activeTab : ''}
						onValueChange={(value) => {
							if (value && (SECONDARY_TABS as readonly string[]).includes(value)) {
								setTab(value as SecondaryTabKey);
							}
						}}
					>
						<DropdownMenu.RadioItem
							value="catalog"
							class="min-h-11 cursor-pointer gap-2 py-2.5 text-sm font-semibold"
						>
							<Warehouse class="h-4 w-4 shrink-0" aria-hidden="true" />
							สินค้า (Master)
						</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem
							value="sphere"
							class="min-h-11 cursor-pointer gap-2 py-2.5 text-sm font-semibold"
						>
							<Scale class="h-4 w-4 shrink-0" aria-hidden="true" />
							วิเคราะห์ความต้องการพื้นฐาน
						</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem
							value="food-sphere"
							class="min-h-11 cursor-pointer gap-2 py-2.5 text-sm font-semibold"
						>
							<Utensils class="h-4 w-4 shrink-0" aria-hidden="true" />
							วิเคราะห์เสบียงอาหาร
						</DropdownMenu.RadioItem>
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>

	{#if activeTab === 'inventory'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<StockTable {occupancy} />
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
