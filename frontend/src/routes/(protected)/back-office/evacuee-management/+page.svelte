<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Users from '@lucide/svelte/icons/users';
	import Home from '@lucide/svelte/icons/home';
	import BarChart2 from '@lucide/svelte/icons/bar-chart-2';
	import EvacueeTab from './evacuee-tab.svelte';
	import HouseholdTab from './household-tab.svelte';
	import DashboardTab from './dashboard-tab.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	type TabKey = 'dashboard' | 'evacuee' | 'household';
	const tabKeys: readonly TabKey[] = ['dashboard', 'evacuee', 'household'];
	const activeTab = $derived.by<TabKey>(() => {
		const requestedTab = page.url.searchParams.get('tab') as TabKey | null;
		return requestedTab && tabKeys.includes(requestedTab) ? requestedTab : 'dashboard';
	});

	function selectTab(tab: TabKey) {
		void goto(resolve(`/back-office/evacuee-management?tab=${tab}`), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<svelte:head>
	<title>จัดการผู้ประสบภัย · SmartShelter</title>
</svelte:head>

<!--
  --bo-evacuee-tabs-height: sticky tab strip (pt-4 + min-h-11 tabs ≈ 3.75rem).
  --bo-evacuee-selection-top: selection bars in tab bodies stick under BO chrome + tabs.
-->
<div
	class="flex flex-col"
	style="--bo-evacuee-tabs-height: 3.75rem; --bo-evacuee-selection-top: calc(var(--bo-sticky-top) + var(--bo-evacuee-tabs-height));"
>
	<!-- Tab nav sticks under BO chrome; offset via --bo-sticky-top (app.css). -->
	<div
		class="sticky top-[var(--bo-sticky-top)] z-20 border-b border-border bg-background px-4 pt-4 sm:px-6"
	>
		<nav class="-mx-1 flex gap-1 overflow-x-auto px-1">
			<button
				type="button"
				onclick={() => selectTab('dashboard')}
				class="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
					{activeTab === 'dashboard'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<BarChart2 class="h-4 w-4" />
				ภาพรวม
			</button>
			<button
				type="button"
				onclick={() => selectTab('evacuee')}
				class="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
					{activeTab === 'evacuee'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Users class="h-4 w-4" />
				รายชื่อผู้ประสบภัย
			</button>
			<button
				type="button"
				onclick={() => selectTab('household')}
				class="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
					{activeTab === 'household'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Home class="h-4 w-4" />
				รายชื่อครัวเรือน
			</button>
		</nav>
	</div>

	<!-- Tab content scrolls with the document -->
	<div class="[scrollbar-gutter:stable]">
		{#if activeTab === 'dashboard'}
			{#if shelterStore.selectedShelterCode}
				<DashboardTab shelterCode={shelterStore.selectedShelterCode} />
			{:else}
				<div class="flex items-center justify-center py-24 text-muted-foreground">
					กำลังโหลดข้อมูลศูนย์พักพิง...
				</div>
			{/if}
		{:else if activeTab === 'evacuee'}
			<EvacueeTab />
		{:else}
			<HouseholdTab />
		{/if}
	</div>
</div>
