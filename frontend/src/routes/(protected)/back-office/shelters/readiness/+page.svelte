<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	let code = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	$effect(() => {
		if (code) {
			goto(resolve(`/back-office/shelters/readiness/${encodeURIComponent(code)}`), {
				replaceState: true
			});
		}
	});
</script>

<div class="flex w-full flex-1 items-center justify-center p-6">
	<p class="text-sm text-slate-500">กำลังเปิดหน้าแบบประเมินความพร้อมศูนย์พักพิง...</p>
</div>
