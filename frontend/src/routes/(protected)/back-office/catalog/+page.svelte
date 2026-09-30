<script lang="ts">
	import ConsoleBanner from '$lib/components/console-banner.svelte';
	import { CatalogWorkspace } from '$lib/features/catalog';
	import RecipeTab from './components/recipe-tab.svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const basePath = resolve('/back-office/catalog');
	const supplyHref = resolve('/back-office/supply');
</script>

<svelte:head>
	<title>สูตรอาหาร · SmartShelter</title>
</svelte:head>

<main class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button href={supplyHref} variant="outline" size="sm" class="gap-1.5">
			<ArrowLeft class="h-4 w-4" />
			กลับคลัง
		</Button>
	</div>
	<ConsoleBanner
		title="สูตรอาหาร"
		description="จัดการสูตรอาหารของศูนย์ — รายการสินค้า master อยู่ที่คลัง (แท็บสินค้า)"
	/>
	<CatalogWorkspace {basePath} scope="shelter">
		{#snippet recipes()}
			<RecipeTab {basePath} />
		{/snippet}
	</CatalogWorkspace>
</main>
