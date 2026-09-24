<script lang="ts">
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import StaffHub from '$lib/components/staff-hub.svelte';
	import StaffSideNav, { type StaffSideNavItem } from '$lib/components/staff-side-nav.svelte';
	import ItemCategoryTab from '../../back-office/catalog/components/item-category-tab.svelte';
	import ItemMasterTab from '../../back-office/catalog/components/item-master-tab.svelte';
	import RecipeTab from '../../back-office/catalog/components/recipe-tab.svelte';
	import UnitOfMeasureTab from '../../back-office/catalog/components/unit-of-measure-tab.svelte';
	import {
		useItemCategories,
		useItemMasters,
		useRecipes,
		useUnitsOfMeasure
	} from '$lib/features/catalog';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

	const itemCategoriesQuery = useItemCategories();
	const itemMastersQuery = useItemMasters();
	const recipesQuery = useRecipes();
	const unitsOfMeasureQuery = useUnitsOfMeasure();

	const totalItemCategories = $derived(itemCategoriesQuery.data?.length ?? 0);
	const totalItemMasters = $derived(itemMastersQuery.data?.length ?? 0);
	const totalRecipes = $derived(recipesQuery.data?.length ?? 0);
	const totalUnitsOfMeasure = $derived(unitsOfMeasureQuery.data?.length ?? 0);

	type CatalogTab = 'item_category' | 'item_master' | 'recipe' | 'unit_of_measure';

	const activeTab = $derived.by((): CatalogTab => {
		const tabParam = page.url.searchParams.get('tab');
		if (
			tabParam === 'item_category' ||
			tabParam === 'item_master' ||
			tabParam === 'recipe' ||
			tabParam === 'unit_of_measure'
		) {
			return tabParam;
		}
		return 'item_category';
	});

	const basePath = resolve('/system-management/catalog');

	function selectTab(tab: CatalogTab) {
		goto(`${basePath}?tab=${tab}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	const items = $derived<StaffSideNavItem[]>([
		{
			id: 'item_category',
			label: 'หมวดหมู่สิ่งของ',
			count: totalItemCategories,
			onclick: () => selectTab('item_category')
		},
		{
			id: 'item_master',
			label: 'รายการสิ่งของ',
			count: totalItemMasters,
			onclick: () => selectTab('item_master')
		},
		{
			id: 'recipe',
			label: 'สูตรอาหารมาตรฐาน',
			count: totalRecipes,
			onclick: () => selectTab('recipe')
		},
		{
			id: 'unit_of_measure',
			label: 'หน่วยนับมาตรฐาน',
			count: totalUnitsOfMeasure,
			onclick: () => selectTab('unit_of_measure')
		}
	]);
</script>

<svelte:head>
	<title>จัดการคลังสินค้า · SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="หมวดคลังสินค้าและทรัพยากร"
	description="จัดการหมวดหมู่สินค้า รายการคลังสิ่งของบรรเทาทุกข์ และสูตรอาหารมาตรฐาน"
	maxWidth="7xl"
>
	<StaffHub>
		{#snippet nav()}
			<StaffSideNav
				{items}
				activeId={activeTab}
				sectionLabel="ประเภทคลัง"
				ariaLabel="ประเภทคลังสินค้า"
			/>
		{/snippet}

		<div class="min-w-0 p-4 sm:p-6">
			{#if activeTab === 'item_category'}
				<ItemCategoryTab {basePath} />
			{:else if activeTab === 'item_master'}
				<ItemMasterTab {basePath} />
			{:else if activeTab === 'recipe'}
				<RecipeTab {basePath} />
			{:else if activeTab === 'unit_of_measure'}
				<UnitOfMeasureTab {basePath} />
			{/if}
		</div>
	</StaffHub>
</StaffPageShell>
