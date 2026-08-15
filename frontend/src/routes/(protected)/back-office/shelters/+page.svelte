<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	// Back-office is already scoped to one shelter — skip the list and open edit.
	const code = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	$effect(() => {
		if (!code) return;
		goto(resolve(`/back-office/shelters/edit/${encodeURIComponent(code)}`), {
			replaceState: true
		});
	});
</script>

<svelte:head>
	<title>จัดการศูนย์พักพิง · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 items-center justify-center p-6">
	<p class="text-sm text-muted-foreground">กำลังเปิดหน้าแก้ไขศูนย์พักพิง...</p>
</div>
