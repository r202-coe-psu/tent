<script lang="ts" generics="T extends { value: string; label: string }">
	import { tick } from 'svelte';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CheckIcon from '@lucide/svelte/icons/check';

	let {
		items = [],
		value = $bindable(''),
		placeholder = 'Select...',
		searchPlaceholder = 'Search...',
		emptyText = 'No results found.',
		class: className,
		disabled = false,
		controlProps = {},
		children: itemSnippet,
		...restProps
	}: {
		items: T[];
		value?: string;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		class?: string;
		disabled?: boolean;
		controlProps?: Record<string, unknown>;
		children?: import('svelte').Snippet<[{ item: T; selected: boolean }]>;
		onValueChange?: (value: string) => void;
	} = $props();

	let open = $state(false);
	let triggerRef = $state<HTMLButtonElement>(null!);

	const selectedItem = $derived(items.find((i) => i.value === value));

	function onSelect(item: T) {
		value = item.value;
		open = false;
		tick().then(() => triggerRef.focus());
	}

	function getItemKeywords(item: T): string[] {
		const raw = item as { label?: string; sku?: string; keywords?: string[] };
		const set = new Set<string>();
		if (raw.label) set.add(raw.label);
		if (raw.sku) set.add(raw.sku);
		if (Array.isArray(raw.keywords)) {
			for (const k of raw.keywords) {
				if (k) set.add(k);
			}
		}
		return Array.from(set);
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger bind:ref={triggerRef}>
		{#snippet child({ props })}
			<Button
				{...props}
				{...controlProps}
				variant="outline"
				role="combobox"
				aria-expanded={open}
				{disabled}
				class={cn('w-full justify-between font-normal', className)}
			>
				<span class="truncate">
					{#if selectedItem}
						{selectedItem.label}
						{#if (selectedItem as { sku?: string }).sku}
							<span class="font-mono text-xs opacity-75">
								({(selectedItem as { sku?: string }).sku})</span
							>
						{/if}
					{:else}
						{placeholder}
					{/if}
				</span>
				<ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class="w-(--bits-floating-anchor-width) min-w-(--bits-floating-anchor-width) p-0"
	>
		<Command.Root>
			<Command.Input placeholder={searchPlaceholder} />
			<Command.List>
				<Command.Empty>{emptyText}</Command.Empty>
				<Command.Group>
					{#each items as item (item.value)}
						<Command.Item
							value={item.value}
							keywords={getItemKeywords(item)}
							onSelect={() => onSelect(item)}
						>
							<CheckIcon class={cn('size-4', value !== item.value && 'text-transparent')} />
							{#if itemSnippet}
								{@render itemSnippet({ item, selected: value === item.value })}
							{:else}
								<div class="flex items-center gap-2">
									<span>{item.label}</span>
									{#if (item as { sku?: string }).sku}
										<span class="font-mono text-xs opacity-70"
											>({(item as { sku?: string }).sku})</span
										>
									{/if}
								</div>
							{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
