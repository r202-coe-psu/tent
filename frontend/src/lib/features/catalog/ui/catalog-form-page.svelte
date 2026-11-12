<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BackLink from '$lib/components/back-link.svelte';
	import ItemCategoryForm from './item-category-form.svelte';
	import ItemMasterForm from './item-master-form.svelte';
	import RecipeForm from './recipe-form.svelte';

	let {
		entity,
		mode,
		id = '',
		basePath = '/back-office/catalog',
		backLabel = 'กลับไปคลังสินค้า'
	}: {
		entity: 'item-categories' | 'item-masters' | 'recipe' | 'recipes';
		mode: 'create' | 'edit';
		id?: string;
		basePath?: string;
		backLabel?: string;
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
		goto(resolve(basePath as '/back-office/catalog'));
	}
</script>

<div class="container mx-auto max-w-4xl p-6">
	<div class="mb-6">
		<BackLink
			href={resolve(basePath as '/back-office/catalog')}
			label={backLabel}
			class="mb-1 -ml-3"
		/>
		<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
	</div>
	<div class="rounded-2xl border border-border bg-card p-6 shadow-xs">
		{#if entity === 'item-categories'}
			<ItemCategoryForm {id} isEdit={mode === 'edit'} {basePath} onsuccess={handleBack} />
		{:else if entity === 'item-masters'}
			<ItemMasterForm {id} isEdit={mode === 'edit'} {basePath} onsuccess={handleBack} />
		{:else if entity === 'recipes' || entity === 'recipe'}
			<RecipeForm {id} isEdit={mode === 'edit'} {basePath} onsuccess={handleBack} />
		{/if}
	</div>
</div>
