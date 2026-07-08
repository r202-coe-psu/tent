<script lang="ts">
	import { page } from '$app/state';
	import Users from '@lucide/svelte/icons/users';
	import Home from '@lucide/svelte/icons/home';
	import BarChart2 from '@lucide/svelte/icons/bar-chart-2';
	import EvacueeTab from './evacuee-tab.svelte';
	import HouseholdTab from './household-tab.svelte';
	import DashboardTab from './dashboard-tab.svelte';
	import { backofficeState } from '$lib/stores/backoffice.svelte';

	type TabKey = 'dashboard' | 'evacuee' | 'household';
	let activeTab = $state<TabKey>((page.url.searchParams.get('tab') as TabKey) || 'dashboard');
</script>

<svelte:head>
	<title>จัดการผู้ประสบภัย · SmartShelter</title>
</svelte:head>

<div class="flex h-full flex-col">
	<!-- Tab nav -->
	<div class="shrink-0 border-b border-border bg-background px-6 pt-4">
		<nav class="flex gap-1">
			<button
				type="button"
				onclick={() => (activeTab = 'dashboard')}
				class="flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
					{activeTab === 'dashboard'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<BarChart2 class="h-4 w-4" />
				ภาพรวม
			</button>
			<button
				type="button"
				onclick={() => (activeTab = 'evacuee')}
				class="flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
					{activeTab === 'evacuee'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Users class="h-4 w-4" />
				รายชื่อผู้ประสบภัย
			</button>
			<button
				type="button"
				onclick={() => (activeTab = 'household')}
				class="flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
					{activeTab === 'household'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Home class="h-4 w-4" />
				รายชื่อครัวเรือน
			</button>
		</nav>
	</div>

	<!-- Tab content -->
	<div class="flex-1 overflow-auto">
		{#if activeTab === 'dashboard'}
			{#if backofficeState.selectedShelter}
				<DashboardTab shelterCode={backofficeState.selectedShelter} />
			{:else}
				<div class="flex h-full items-center justify-center text-muted-foreground">
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
