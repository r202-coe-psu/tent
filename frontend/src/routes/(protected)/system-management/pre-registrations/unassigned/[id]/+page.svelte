<script lang="ts">
	import { page } from '$app/state';
	import { PreRegistrationProfilePage } from '$lib/features/system-overview';

	const id = $derived(page.params.id ?? '');
</script>

<svelte:head>
	<title>โปรไฟล์ Pre-registration — SmartShelter</title>
</svelte:head>

<PreRegistrationProfilePage unassignedId={id} />
