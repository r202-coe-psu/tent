<script lang="ts">
	import { CatalogFormPage } from '$lib/features/catalog';

	let { data } = $props();
</script>

<svelte:head>
	<title>จัดการแคตตาล็อก · SmartShelter</title>
</svelte:head>

<CatalogFormPage entity={data.entity} mode={data.mode} id={data.id} />
