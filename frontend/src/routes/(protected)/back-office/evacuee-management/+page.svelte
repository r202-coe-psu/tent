<script lang="ts">
	import { page } from '$app/state';
	import Users from '@lucide/svelte/icons/users';
	import Home from '@lucide/svelte/icons/home';
	import EvacueeTab from './evacuee-tab.svelte';
	import HouseholdTab from './household-tab.svelte';

	type TabKey = 'evacuee' | 'household';
	let activeTab = $state<TabKey>((page.url.searchParams.get('tab') as TabKey) || 'evacuee');
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
		{#if activeTab === 'evacuee'}
			<EvacueeTab />
		{:else}
			<HouseholdTab />
		{/if}
	</div>
</div>
