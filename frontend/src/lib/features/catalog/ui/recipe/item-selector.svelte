<!-- src/lib/features/catalog/ui/recipe/item-selector.svelte -->
<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import type { ItemMaster } from '../../domain/catalog';
	import { formatUnit } from '../../domain/unit-of-measure';
	import { useUnitsOfMeasure } from '../../application/queries';
	import { langState } from '$lib/states/i18n.svelte';
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
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

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

<div class="relative w-full min-w-0">
	<div class="relative">
		<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
		<Input
			type="text"
			bind:value={searchTerm}
			onfocus={() => (isOpen = true)}
			onblur={handleBlur}
			placeholder="ค้นหาชื่อวัตถุดิบ..."
			class="h-11 pl-10 sm:h-10"
		/>
	</div>

	{#if isOpen && filtered.length > 0}
		<ul
			class="absolute top-full left-0 z-50 mt-1 max-h-56 w-full min-w-[16rem] overflow-y-auto rounded-xl border border-border bg-popover py-1.5 text-popover-foreground shadow-lg"
		>
			{#each filtered as item (item._id)}
				<li>
					<button
						type="button"
						class="w-full cursor-pointer px-4 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
						onmousedown={() => handleSelect(item)}
					>
						<span class="font-bold text-foreground">{item.name}</span>
						{#if item.sku}
							<span class="ml-1 text-xs text-muted-foreground">({item.sku})</span>
						{/if}
						<span
							class="ml-2 rounded-lg bg-muted px-2 py-0.5 text-2xs font-bold text-muted-foreground"
						>
							{formatUnit(item.base_unit, units, langState.current)}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if isOpen}
		<div
			class="absolute top-full left-0 z-50 mt-1 w-full min-w-[16rem] rounded-xl border border-border bg-popover px-4 py-3 text-center text-xs font-semibold text-muted-foreground shadow-lg"
		>
			ไม่พบข้อมูลวัตถุดิบ
		</div>
	{/if}
</div>
