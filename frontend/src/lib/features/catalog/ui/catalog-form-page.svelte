<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ItemCategoryForm from './item-category-form.svelte';
	import ItemMasterForm from './item-master-form.svelte';
	import RecipeForm from './recipe-form.svelte';

	let {
		entity,
		mode,
		id = ''
	}: {
		entity: 'item-categories' | 'item-masters' | 'recipe' | 'recipes';
		mode: 'create' | 'edit';
		id?: string;
	} = $props();

	const title = $derived(
		`${mode === 'create' ? 'เพิ่ม' : 'แก้ไข'}${
			entity === 'item-categories'
				? 'หมวดสินค้า'
				: entity === 'item-masters'
					? 'รายการสินค้าหลัก'
					: 'สูตรอาหาร'
		}`
	);

	function handleBack() {
		goto(resolve('/back-office/catalog'));
	}
</script>

<div class="container mx-auto max-w-4xl p-6">
	<div class="mb-6 flex items-center gap-4">
		<Button variant="outline" size="icon" onclick={handleBack}>
			<ChevronLeft class="h-5 w-5" />
		</Button>
		<div>
			<span class="text-xs text-muted-foreground">หมวดคลังสินค้าและทรัพยากร</span>
			<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
		</div>
	</div>
	<div class="rounded-2xl border border-border bg-card p-6 shadow-xs">
		{#if entity === 'item-categories'}
			<ItemCategoryForm {id} isEdit={mode === 'edit'} onsuccess={handleBack} />
		{:else if entity === 'item-masters'}
			<ItemMasterForm {id} isEdit={mode === 'edit'} onsuccess={handleBack} />
		{:else if entity === 'recipes' || entity === 'recipe'}
			<RecipeForm {id} isEdit={mode === 'edit'} onsuccess={handleBack} />
		{/if}
	</div>
</div>
