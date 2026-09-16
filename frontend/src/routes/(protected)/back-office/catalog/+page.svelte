<script lang="ts">
	import ConsoleBanner from '$lib/components/console-banner.svelte';
	import ItemCategoryTab from './components/item-category-tab.svelte';
	import ItemMasterTab from './components/item-master-tab.svelte';
	import RecipeTab from './components/recipe-tab.svelte';
	import { useItemCategories, useItemMasters, useRecipes } from '$lib/features/catalog';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getShelterCode } from '$lib/db/shelter';

	const itemCategoriesQuery = useItemCategories(() => getShelterCode());
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const recipesQuery = useRecipes(() => getShelterCode());

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

	const basePath = resolve('/back-office/catalog');

	function selectTab(tab: 'item_category' | 'item_master' | 'recipe') {
		activeTab = tab;
		goto(`${basePath}?tab=${tab}`, { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<svelte:head>
	<title>หมวดคลังสินค้าและทรัพยากร — SmartShelter</title>
	<meta
		name="description"
		content="จัดการหมวดหมู่สินค้า รายการคลังสิ่งของบรรเทาทุกข์ และสูตรอาหารมาตรฐาน"
	/>
</svelte:head>

<main class="container mx-auto space-y-4 px-4 py-6">
	<ConsoleBanner
		title="4. หมวดคลังสินค้าและทรัพยากร (Inventory & Resource)"
		description="จัดการหมวดหมู่สินค้า รายการคลังสิ่งของบรรเทาทุกข์ และสูตรอาหารมาตรฐาน"
	/>
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
		<aside class="min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
			<h2 class="mb-3 text-sm font-semibold text-muted-foreground">ประเภทพารามิเตอร์มาสเตอร์</h2>
			<nav class="flex flex-col gap-2">
				<button
					type="button"
					onclick={() => selectTab('item_category')}
					aria-current={activeTab === 'item_category' ? 'page' : undefined}
					class="group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition {activeTab ===
					'item_category'
						? 'border-transparent bg-primary text-primary-foreground shadow-xs'
						: 'border-input bg-background hover:bg-accent'}"
				>
					<div class="flex-1">
						<div class="text-sm leading-tight font-semibold">หมวดหมู่สิ่งของ (Item Category)</div>
					</div>
					<span
						class="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold {activeTab ===
						'item_category'
							? 'bg-primary-foreground/20 text-primary-foreground'
							: 'bg-muted text-foreground'}"
					>
						{totalItemCategories}
					</span>
				</button>
				<button
					type="button"
					onclick={() => selectTab('item_master')}
					aria-current={activeTab === 'item_master' ? 'page' : undefined}
					class="group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition {activeTab ===
					'item_master'
						? 'border-transparent bg-primary text-primary-foreground shadow-xs'
						: 'border-input bg-background hover:bg-accent'}"
				>
					<div class="flex-1">
						<div class="text-sm leading-tight font-semibold">รายการสิ่งของ (Item Master)</div>
					</div>
					<span
						class="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold {activeTab ===
						'item_master'
							? 'bg-primary-foreground/20 text-primary-foreground'
							: 'bg-muted text-foreground'}"
					>
						{totalItemMasters}
					</span>
				</button>
				<button
					type="button"
					onclick={() => selectTab('recipe')}
					aria-current={activeTab === 'recipe' ? 'page' : undefined}
					class="group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition {activeTab ===
					'recipe'
						? 'border-transparent bg-primary text-primary-foreground shadow-xs'
						: 'border-input bg-background hover:bg-accent'}"
				>
					<div class="flex-1">
						<div class="text-sm leading-tight font-semibold">สูตรอาหารมาตรฐาน (BOM)</div>
					</div>
					<span
						class="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold {activeTab ===
						'recipe'
							? 'bg-primary-foreground/20 text-primary-foreground'
							: 'bg-muted text-foreground'}"
					>
						{totalRecipes}
					</span>
				</button>
			</nav>
		</aside>
		<div class="min-w-0">
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
