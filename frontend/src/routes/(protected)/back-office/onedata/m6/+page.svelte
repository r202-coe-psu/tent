<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import PackageSearch from '@lucide/svelte/icons/package-search';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		CatalogSearchPanel,
		M6_NO_RESOURCE_TYPES_MESSAGE,
		WarehousesPanel,
		WithdrawalCartPanel,
		WithdrawalCartState,
		WithdrawalListPanel
	} from '$lib/features/central-warehouse';
	import {
		INTEGRATION_GATE_MESSAGES,
		IntegrationGateAlert,
		blockedStateOf,
		isGateReady,
		useIntegrationStatus
	} from '$lib/features/integrations';

	const TABS = ['warehouses', 'catalog', 'cart', 'requests'] as const;
	type TabKey = (typeof TABS)[number];

	// The tab lives in `?tab=` so back, refresh and a shelter switch keep it.
	const requestedTab = $derived(page.url.searchParams.get('tab'));
	const activeTab = $derived<TabKey>(TABS.find((t) => t === requestedTab) ?? 'warehouses');

	function switchTab(tab: string) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('tab', tab);
		void goto(resolve(`/back-office/onedata/m6?${params}` as '/back-office/onedata/m6'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	// The back-office layout remounts this page on a shelter switch, so a cart never crosses shelters.
	const cart = new WithdrawalCartState(getShelterCode());

	let selectedWarehouse = $state<string | null>(null);
	let stockSearch = $state('');

	function viewStock(warehouseCode: string, name: string) {
		selectedWarehouse = warehouseCode;
		stockSearch = name;
		switchTab('warehouses');
	}

	const statusQuery = useIntegrationStatus();
	// A status read that itself fails is the same gate state as an unreachable central system.
	const m6State = $derived(
		statusQuery.data?.m6.state ?? (statusQuery.isError ? 'central_unreachable' : undefined)
	);
	const gateReady = $derived(isGateReady(m6State));
	const blocked = $derived(blockedStateOf(m6State));
	const noResourceTypes = $derived(blocked === 'm6_credential_invalid');
	const gateDescription = $derived(
		noResourceTypes
			? M6_NO_RESOURCE_TYPES_MESSAGE
			: 'ดูคลัง ค้นของ และส่งคำขอเบิกไม่ได้ในตอนนี้ ตะกร้าที่เลือกไว้จะยังอยู่ และดูคำขอเดิมของศูนย์ได้ที่แท็บ "คำขอของศูนย์"'
	);

	const triggerClass =
		'flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-transparent px-1.5 py-2 text-center text-xs leading-tight font-semibold tracking-wide whitespace-normal text-muted-foreground transition-all duration-300 hover:text-foreground active:scale-[0.98] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm sm:shrink-0 sm:flex-row sm:gap-2 sm:px-3.5 sm:whitespace-nowrap md:px-5 md:py-2.5';
</script>

<svelte:head>
	<title>OneData ระบบบริหารทรัพยากร (M6) · SmartShelter</title>
</svelte:head>

<div class="space-y-1 border-b border-border/60 pb-5">
	<p class="text-sm font-semibold text-muted-foreground">OneData Platform</p>
	<h1 class="text-2xl leading-snug font-bold tracking-tight text-slate-900 md:text-3xl">
		OneData ระบบบริหารทรัพยากร (M6)
	</h1>
	<p class="text-sm text-muted-foreground">
		ดูคลังกลางของจังหวัด ขอเบิกของเข้าศูนย์ และติดตามสถานะ เมื่อ M6 ส่งของออกจากคลัง
		ระบบจะสร้างรายการรับของใน
		<a
			href={resolve('/back-office/stock-donations')}
			class="font-semibold text-primary underline underline-offset-2">รายการบริจาค</a
		>
		ให้รับของเข้าสต็อกตามขั้นตอนเดิม
	</p>
</div>

{#if blocked}
	<IntegrationGateAlert
		title={noResourceTypes ? M6_NO_RESOURCE_TYPES_MESSAGE : INTEGRATION_GATE_MESSAGES[blocked]}
		description={noResourceTypes ? undefined : gateDescription}
		checking={statusQuery.isFetching}
		onRetry={() => statusQuery.refetch()}
	/>
{/if}

<Tabs.Root value={activeTab} onValueChange={switchTab} class="gap-4 md:gap-6">
	<div class="flex w-full scrollbar-none overflow-x-auto pb-1 sm:pb-0">
		<Tabs.List
			class="grid h-auto w-full grid-cols-2 rounded-xl border border-border/40 bg-muted/60 p-1 shadow-sm sm:inline-flex sm:w-auto sm:min-w-max sm:justify-start"
		>
			<Tabs.Trigger value="warehouses" class={triggerClass}>
				<Warehouse class="h-4 w-4" aria-hidden="true" />
				คลังกลาง
			</Tabs.Trigger>
			<Tabs.Trigger value="catalog" class={triggerClass}>
				<PackageSearch class="h-4 w-4" aria-hidden="true" />
				ค้นหาของ
			</Tabs.Trigger>
			<Tabs.Trigger value="cart" class={triggerClass}>
				<ShoppingCart class="h-4 w-4" aria-hidden="true" />
				ตะกร้าขอเบิก
				{#if cart.count > 0}
					<span
						class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs leading-none font-bold text-white tabular-nums"
						aria-label="ในตะกร้า {cart.count} รายการ"
					>
						{cart.count}
					</span>
				{/if}
			</Tabs.Trigger>
			<Tabs.Trigger value="requests" class={triggerClass}>
				<ClipboardList class="h-4 w-4" aria-hidden="true" />
				คำขอของศูนย์
			</Tabs.Trigger>
		</Tabs.List>
	</div>

	<Tabs.Content value="warehouses">
		<WarehousesPanel
			{cart}
			enabled={gateReady}
			bind:selectedCode={selectedWarehouse}
			bind:stockSearch
			onOpenCart={() => switchTab('cart')}
		/>
	</Tabs.Content>

	<Tabs.Content value="catalog">
		<CatalogSearchPanel enabled={gateReady} onViewStock={viewStock} />
	</Tabs.Content>

	<Tabs.Content value="cart">
		<WithdrawalCartPanel {cart} enabled={gateReady} onSubmitted={() => switchTab('requests')} />
	</Tabs.Content>

	<Tabs.Content value="requests">
		<WithdrawalListPanel cancelEnabled={gateReady}>
			{#snippet donationLink()}
				<a
					href={resolve('/back-office/stock-donations')}
					class="font-semibold text-primary underline underline-offset-2">รายการบริจาค</a
				>
			{/snippet}
		</WithdrawalListPanel>
	</Tabs.Content>
</Tabs.Root>
