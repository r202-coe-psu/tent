<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MealCoveragePanel } from '$lib/features/distribution';
	import { shelterStore } from '$lib/stores/shelter.svelte';
</script>

<svelte:head>
	<title>ภาพรวมการแจกจ่ายอาหาร · SmartShelter</title>
</svelte:head>

<div class="p-4 sm:p-6">
	{#key shelterStore.selectedShelterCode}
		<MealCoveragePanel
			shelterCode={shelterStore.selectedShelterCode ?? undefined}
			onOpenPerson={(id) => goto(resolve(`/back-office/evacuee-management/edit/evacuee/${id}`))}
		/>
	{/key}
</div>
