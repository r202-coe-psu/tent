<script lang="ts">
	import ItemCategoryTab from '../../../back-office/catalog/components/item-category-tab.svelte';
	import ItemMasterTab from '../../../back-office/catalog/components/item-master-tab.svelte';
	import RecipeTab from '../../../back-office/catalog/components/recipe-tab.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { useItemCategories, useItemMasters, useRecipes } from '$lib/features/catalog';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

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

	const basePath = resolve('/portal/system-management/catalog');
</script>

<svelte:head>
	<title>จัดการคลังสินค้า · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-6 p-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="text-2xl font-bold tracking-tight text-foreground">
				จัดการคลังสินค้า (Central Catalog)
			</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				จัดการประเภทสิ่งของ รายการสินค้าหลัก และสูตรอาหารมาตรฐานในระบบส่วนกลาง
			</p>
		</div>
	</div>

	<div class="item-start mt-2 grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
		<div class="border-md flex h-fit flex-col rounded-xl border bg-card p-4 shadow-xs">
			<span class="text-sm font-semibold text-muted-foreground">ประเภทพารามิเตอร์มาสเตอร์</span>
			<Separator class="my-3" />
			<div class="flex flex-col gap-2">
				<Button
					size="lg"
					variant={activeTab === 'item_category' ? 'default' : 'outline'}
					onclick={() => (activeTab = 'item_category')}
					class="w-full justify-between py-6"
				>
					<span>หมวดหมู่สิ่งของ (Item Category)</span>
					<span class="rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalItemCategories}</span>
				</Button>
				<Button
					size="lg"
					variant={activeTab === 'item_master' ? 'default' : 'outline'}
					onclick={() => (activeTab = 'item_master')}
					class="w-full justify-between py-6"
				>
					<span>รายการสิ่งของ (Item Master)</span>
					<span class="rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalItemMasters}</span>
				</Button>
				<Button
					size="lg"
					variant={activeTab === 'recipe' ? 'default' : 'outline'}
					onclick={() => (activeTab = 'recipe')}
					class="w-full justify-between py-6"
				>
					<span>สูตรอาหารมาตรฐาน</span>
					<span class="rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalRecipes}</span>
				</Button>
			</div>
		</div>
		<div class="col-span-1 flex lg:col-span-2">
			{#if activeTab === 'item_category'}
				<ItemCategoryTab />
			{:else if activeTab === 'item_master'}
				<ItemMasterTab {basePath} />
			{:else if activeTab === 'recipe'}
				<RecipeTab />
			{/if}
		</div>
	</div>
</div>
