<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import ProductsPanel from './products-panel.svelte';

	type CatalogTab = 'items' | 'recipes' | 'units';

	let {
		basePath,
		scope,
		recipes,
		units
	}: {
		basePath: string;
		scope: 'central' | 'shelter';
		recipes?: Snippet;
		units?: Snippet;
	} = $props();

	function normalizeTab(raw: string | null): CatalogTab {
		if (raw === 'items' || raw === 'item_master' || raw === 'item_category') return 'items';
		if (raw === 'recipes' || raw === 'recipe') return 'recipes';
		if (raw === 'units' || raw === 'unit_of_measure') {
			return scope === 'central' ? 'units' : 'items';
		}
		return 'items';
	}

	const activeTab = $derived(normalizeTab(page.url.searchParams.get('tab')));

	function selectTab(tab: CatalogTab) {
		if (tab === 'units' && scope !== 'central') return;
		if (scope === 'central') {
			void goto(resolve(`/system-management/catalog?tab=${tab}` as '/system-management/catalog'), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		} else {
			void goto(resolve(`/back-office/catalog?tab=${tab}` as '/back-office/catalog'), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		}
	}
</script>

<div class="space-y-4">
	<Tabs.Root
		value={activeTab}
		onValueChange={(v) => {
			if (v === 'items' || v === 'recipes' || v === 'units') selectTab(v);
		}}
	>
		<Tabs.List
			class="grid h-auto w-full grid-cols-1 gap-1 rounded-2xl bg-muted p-1.5 sm:inline-flex sm:w-auto sm:grid-cols-none"
		>
			<Tabs.Trigger
				value="items"
				class="h-auto justify-start rounded-xl px-3.5 py-2.5 text-sm font-medium data-[state=active]:font-bold sm:justify-center"
			>
				สินค้า
			</Tabs.Trigger>
			<Tabs.Trigger
				value="recipes"
				class="h-auto justify-start rounded-xl px-3.5 py-2.5 text-sm font-medium data-[state=active]:font-bold sm:justify-center"
			>
				สูตรอาหาร
			</Tabs.Trigger>
			{#if scope === 'central'}
				<Tabs.Trigger
					value="units"
					class="h-auto justify-start rounded-xl px-3.5 py-2.5 text-sm font-medium data-[state=active]:font-bold sm:justify-center"
				>
					หน่วยนับ
				</Tabs.Trigger>
			{/if}
		</Tabs.List>

		<Tabs.Content value="items" class="pt-4">
			<ProductsPanel {basePath} {scope} />
		</Tabs.Content>

		<Tabs.Content value="recipes" class="pt-4">
			{#if recipes}
				{@render recipes()}
			{:else}
				<p class="text-sm text-muted-foreground">ยังไม่มีเนื้อหาสูตรอาหาร</p>
			{/if}
		</Tabs.Content>

		{#if scope === 'central'}
			<Tabs.Content value="units" class="pt-4">
				{#if units}
					{@render units()}
				{:else}
					<p class="text-sm text-muted-foreground">ยังไม่มีเนื้อหาหน่วยนับ</p>
				{/if}
			</Tabs.Content>
		{/if}
	</Tabs.Root>
</div>
