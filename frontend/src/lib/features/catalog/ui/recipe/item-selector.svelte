<!-- src/lib/features/catalog/ui/recipe/item-selector.svelte -->
<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import type { ItemMaster } from '../../domain/catalog';
	import Search from '@lucide/svelte/icons/search';

	let {
		value = $bindable(''),
		uom = $bindable<string>(),
		items = []
	}: {
		value: string;
		uom: string;
		items: ItemMaster[];
	} = $props();

	let searchTerm = $state('');
	let isOpen = $state(false);

	// Sync input text when the bound value changes (e.g. initial load)
	$effect(() => {
		const matched = items.find((i) => i._id === value);
		if (matched) {
			searchTerm = matched.name;
			if (!uom || uom !== matched.base_unit) {
				uom = matched.base_unit;
			}
		} else if (!value) {
			searchTerm = '';
		}
	});

	const filtered = $derived(
		searchTerm.trim()
			? items.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()))
			: items
	);

	function handleSelect(item: ItemMaster) {
		value = item._id;
		searchTerm = item.name;
		isOpen = false;
	}

	function handleBlur() {
		// Delayed close to allow click event to register
		setTimeout(() => {
			isOpen = false;
			const matched = items.find((i) => i._id === value);
			searchTerm = matched ? matched.name : '';
		}, 150);
	}
</script>

<div class="relative w-full">
	<div class="relative">
		<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
		<Input
			type="text"
			bind:value={searchTerm}
			onfocus={() => (isOpen = true)}
			onblur={handleBlur}
			placeholder="ค้นหาชื่อวัตถุดิบ..."
			class="h-12 rounded-xl border-slate-200/80 bg-white pl-10 text-sm focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
		/>
	</div>

	{#if isOpen && filtered.length > 0}
		<ul
			class="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-100 bg-popover py-1.5 text-popover-foreground shadow-lg dark:border-zinc-800"
		>
			{#each filtered as item (item._id)}
				<li>
					<button
						type="button"
						class="w-full cursor-pointer px-4 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
						onmousedown={() => handleSelect(item)}
					>
						<span class="font-bold text-slate-700 dark:text-slate-200">{item.name}</span>
						{#if item.sku}
							<span class="ml-1 text-xs text-muted-foreground">({item.sku})</span>
						{/if}
						<span
							class="ml-2 rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-zinc-800 dark:text-zinc-400"
						>
							{item.base_unit}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if isOpen}
		<div
			class="absolute z-50 mt-1 w-full rounded-xl border border-slate-100 bg-popover px-4 py-3 text-center text-xs font-semibold text-muted-foreground shadow-lg dark:border-zinc-800"
		>
			ไม่พบข้อมูลวัตถุดิบ
		</div>
	{/if}
</div>
