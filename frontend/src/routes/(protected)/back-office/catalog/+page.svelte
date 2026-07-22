<script lang="ts">
	import BackofficeHeader from '$lib/components/backoffice-header.svelte';
	import ItemCategoryTab from './components/item-category-tab.svelte';
	import ItemMasterTab from './components/item-master-tab.svelte';
	import RecipeTab from './components/recipe-tab.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { useItemCategories, useItemMasters, useRecipes } from '$lib/features/catalog';
	import { page } from '$app/state';

	const itemCategoriesQuery = useItemCategories();
	const itemMastersQuery = useItemMasters();
	const recipesQuery = useRecipes();

	const totalItemCategories = $derived(itemCategoriesQuery.data?.length ?? 0);
	const totalItemMasters = $derived(itemMastersQuery.data?.length ?? 0);
	const totalRecipes = $derived(recipesQuery.data?.length ?? 0);

	let activeTab = $state<'item_category' | 'item_master' | 'recipe'>('item_category');

	$effect(() => {
		const tabParam = page.url.searchParams.get('tab');
		if (tabParam === 'item_category' || tabParam === 'item_master' || tabParam === 'recipe') {
			activeTab = tabParam;
		}
	});
</script>

<main class="container mx-auto px-4">
	<BackofficeHeader title="2. หมวดคลังสินค้าและทรัพยากร (Inventory & Resource)" />
	<div class="item-start mt-4 grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
		<div class="border-md flex h-fit flex-col rounded-xl border p-4 shadow-md">
			<span>ประเภทพารามิเตอร์มาสเตอร์</span>
			<Separator class="my-3 bg-black" />
			<div class="flex flex-col gap-2">
				<Button
					size="lg"
					variant={activeTab === 'item_category' ? 'default' : 'outline'}
					onclick={() => (activeTab = 'item_category')}
					class="w-full justify-between py-6"
				>
					<span>หมวดหมู่สิ่งของ (Item Category)</span>
					<span class=" rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalItemCategories}</span>
				</Button>
				<Button
					size="lg"
					variant={activeTab === 'item_master' ? 'default' : 'outline'}
					onclick={() => (activeTab = 'item_master')}
					class="w-full justify-between py-6"
				>
					<span>รายการสิ่งของ (Item Master)</span>
					<span class=" rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalItemMasters}</span>
				</Button>
				<Button
					size="lg"
					variant={activeTab === 'recipe' ? 'default' : 'outline'}
					onclick={() => (activeTab = 'recipe')}
					class="w-full justify-between py-6"
				>
					<span>สูตรอาหารมาตรฐาน </span>
					<span class=" rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalRecipes}</span>
				</Button>
			</div>
		</div>
		<div class="col-span-1 flex lg:col-span-2">
			{#if activeTab === 'item_category'}
				<ItemCategoryTab />
			{:else if activeTab === 'item_master'}
				<ItemMasterTab />
			{:else if activeTab === 'recipe'}
				<RecipeTab />
			{/if}
		</div>
	</div>
</main>
