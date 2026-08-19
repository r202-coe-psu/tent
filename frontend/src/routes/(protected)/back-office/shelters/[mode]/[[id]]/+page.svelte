<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ShelterFormPage } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	let { data } = $props();

	/** Last edit id we aligned the header selector to (URL → store). */
	let syncedEditId = $state<string | null>(null);

	// Deep-link / menu open: keep the header selector on the shelter being edited.
	$effect(() => {
		if (data.mode !== 'edit' || !data.id) return;
		if (syncedEditId === data.id) return;
		syncedEditId = data.id;
		shelterStore.selectedShelterCode = data.id;
	});

	// Header selector change while editing: open that shelter's edit page.
	$effect(() => {
		if (data.mode !== 'edit' || !data.id) return;
		const selected = shelterStore.selectedShelterCode;
		if (!selected || selected === data.id) return;
		if (syncedEditId !== data.id) return;
		goto(resolve(`/back-office/shelters/edit/${encodeURIComponent(selected)}`), {
			replaceState: true
		});
	});
</script>

<ShelterFormPage id={data.id ?? ''} isEdit={data.mode === 'edit'} />
