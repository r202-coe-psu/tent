<script lang="ts">
	import ConsoleBanner from '$lib/components/console-banner.svelte';
	import { CatalogWorkspace } from '$lib/features/catalog';
	import RecipeTab from './components/recipe-tab.svelte';
	import { resolve } from '$app/paths';

	const basePath = resolve('/back-office/catalog');
</script>

<svelte:head>
	<title>คลังสินค้า · SmartShelter</title>
</svelte:head>

<main class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<ConsoleBanner title="คลังสินค้า" description="จัดการรายการสินค้าและสูตรอาหารของศูนย์" />
	<CatalogWorkspace {basePath} scope="shelter">
		{#snippet recipes()}
			<RecipeTab {basePath} />
		{/snippet}
	</CatalogWorkspace>
</main>
