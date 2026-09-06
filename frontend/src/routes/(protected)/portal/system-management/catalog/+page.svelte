<script lang="ts">
	import ConsoleBanner from '$lib/components/console-banner.svelte';
	import ItemCategoryTab from '../../../back-office/catalog/components/item-category-tab.svelte';
	import ItemMasterTab from '../../../back-office/catalog/components/item-master-tab.svelte';
	import RecipeTab from '../../../back-office/catalog/components/recipe-tab.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { useItemCategories, useItemMasters, useRecipes } from '$lib/features/catalog';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

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

	function selectTab(tab: 'item_category' | 'item_master' | 'recipe') {
		activeTab = tab;
		goto(`${basePath}?tab=${tab}`, { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<svelte:head>
	<title>จัดการคลังสินค้า · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<ConsoleBanner
		title="4. หมวดคลังสินค้าและทรัพยากร (Inventory & Resource)"
		description="จัดการหมวดหมู่สินค้า รายการคลังสิ่งของบรรเทาทุกข์ และสูตรอาหารมาตรฐาน"
	/>

	<div class="item-start mt-2 grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
		<div class="border-md flex h-fit flex-col rounded-xl border bg-card p-4 shadow-xs">
			<span class="text-sm font-semibold text-muted-foreground">ประเภทพารามิเตอร์มาสเตอร์</span>
			<Separator class="my-3" />
			<div class="flex flex-col gap-2">
				<Button
					size="lg"
					variant={activeTab === 'item_category' ? 'default' : 'outline'}
					onclick={() => selectTab('item_category')}
					class="w-full justify-between py-6"
				>
					<span>หมวดหมู่สิ่งของ (Item Category)</span>
					<span class="rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalItemCategories}</span>
				</Button>
				<Button
					size="lg"
					variant={activeTab === 'item_master' ? 'default' : 'outline'}
					onclick={() => selectTab('item_master')}
					class="w-full justify-between py-6"
				>
					<span>รายการสิ่งของ (Item Master)</span>
					<span class="rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalItemMasters}</span>
				</Button>
				<Button
					size="lg"
					variant={activeTab === 'recipe' ? 'default' : 'outline'}
					onclick={() => selectTab('recipe')}
					class="w-full justify-between py-6"
				>
					<span>สูตรอาหารมาตรฐาน</span>
					<span class="rounded-sm bg-white/20 p-1 whitespace-nowrap">{totalRecipes}</span>
				</Button>
			</div>
		</div>
		<div class="col-span-1 flex lg:col-span-2">
			{#if activeTab === 'item_category'}
				<ItemCategoryTab {basePath} />
			{:else if activeTab === 'item_master'}
				<ItemMasterTab {basePath} />
			{:else if activeTab === 'recipe'}
				<RecipeTab {basePath} />
			{/if}
		</div>
	</div>
</div>
