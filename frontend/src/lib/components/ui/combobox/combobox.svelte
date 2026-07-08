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
					{selectedItem?.label ?? placeholder}
				</span>
				<ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-[--bits-popover-anchor-width] p-0">
		<Command.Root>
			<Command.Input placeholder={searchPlaceholder} />
			<Command.List>
				<Command.Empty>{emptyText}</Command.Empty>
				<Command.Group>
					{#each items as item (item.value)}
						<Command.Item
							value={item.value}
							keywords={[item.label]}
							onSelect={() => onSelect(item)}
						>
							<CheckIcon class={cn('size-4', value !== item.value && 'text-transparent')} />
							{#if itemSnippet}
								{@render itemSnippet({ item, selected: value === item.value })}
							{:else}
								{item.label}
							{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
