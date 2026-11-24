<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BackLink from '$lib/components/back-link.svelte';
	import ItemCategoryForm from './item-category-form.svelte';
	import ItemMasterForm from './item-master-form.svelte';
	import RecipeForm from './recipe-form.svelte';
	import { EntityHistory } from '$lib/features/audit-log';
	import { authStore } from '$lib/stores/auth.svelte';
	import { canAccessManagerPages, isSystemAdmin } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { useItemCategory, useItemMaster, useRecipe } from '../application/queries';
	import { catalogHistoryScope } from '../domain/catalog-history';

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

	const historyEntityType = $derived(
		entity === 'item-categories'
			? 'item_category'
			: entity === 'item-masters'
				? 'item_master'
				: 'recipe'
	);
	const roles = $derived(authStore.user?.roles ?? []);
	// Same scope the forms resolve the doc with, so these share their query cache.
	const shelterCode = $derived(
		basePath.includes('system-management') ? undefined : getShelterCode()
	);
	const editId = (kind: typeof historyEntityType) =>
		mode === 'edit' && historyEntityType === kind ? id : '';
	const categoryQuery = useItemCategory(
		() => editId('item_category'),
		() => shelterCode ?? null
	);
	const itemMasterQuery = useItemMaster(
		() => editId('item_master'),
		() => shelterCode ?? null
	);
	const recipeQuery = useRecipe(
		() => editId('recipe'),
		() => shelterCode ?? null
	);
	const historyDoc = $derived(
		historyEntityType === 'item_category'
			? categoryQuery.data
			: historyEntityType === 'item_master'
				? itemMasterQuery.data
				: recipeQuery.data
	);
	const history = $derived(
		mode === 'edit' && Boolean(id) && canAccessManagerPages(roles, getShelterCode())
			? catalogHistoryScope(historyDoc, { isSystemAdmin: isSystemAdmin(roles), shelterCode })
			: ({ visible: false } as const)
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
	{#if history.visible}
		<div class="mt-6">
			<EntityHistory
				entityType={historyEntityType}
				entityId={id}
				shelterCode={history.shelterCode}
			/>
		</div>
	{/if}
</div>
