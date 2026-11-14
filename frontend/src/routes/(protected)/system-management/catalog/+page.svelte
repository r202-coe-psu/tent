<script lang="ts">
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { CatalogWorkspace, RecipeTab } from '$lib/features/catalog';
	import UnitOfMeasureTab from '../../back-office/catalog/components/unit-of-measure-tab.svelte';
	import { resolve } from '$app/paths';

	const basePath = resolve('/system-management/catalog');
</script>

<svelte:head>
	<title>คลังสินค้า · SmartShelter</title>
</svelte:head>

<StaffPageShell title="คลังสินค้า" description="จัดการรายการสินค้า สูตรอาหาร และหน่วยนับ">
	<CatalogWorkspace {basePath} scope="central">
		{#snippet recipes()}
			<RecipeTab {basePath} />
		{/snippet}
		{#snippet units()}
			<UnitOfMeasureTab {basePath} />
		{/snippet}
	</CatalogWorkspace>
</StaffPageShell>
