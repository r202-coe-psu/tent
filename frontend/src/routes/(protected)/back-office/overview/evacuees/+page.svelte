<script lang="ts">
	import DashboardTab from './dashboard-tab.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
</script>

<svelte:head>
	<title>ภาพรวมผู้อพยพ · SmartShelter</title>
</svelte:head>

{#if shelterStore.selectedShelterCode}
	{#key shelterStore.selectedShelterCode}
		<DashboardTab shelterCode={shelterStore.selectedShelterCode} />
	{/key}
{:else}
	<div class="flex items-center justify-center py-24 text-muted-foreground">
		กำลังโหลดข้อมูลศูนย์พักพิง...
	</div>
{/if}
