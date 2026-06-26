<script lang="ts" generics="T extends { value: string; label: string }">
	import { cn } from "$lib/utils/shadcn.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import CheckIcon from '@lucide/svelte/icons/check';
	import SearchIcon from '@lucide/svelte/icons/search';

	let {
		items = [],
		value = $bindable(''),
		placeholder = 'Select...',
		emptyText = 'No results found.',
		class: className,
		disabled = false,
		controlProps = {},
		...restProps
	}: {
		items: T[];
		value?: string;
		placeholder?: string;
		emptyText?: string;
		class?: string;
		disabled?: boolean;
		controlProps?: Record<string, unknown>;
	} = $props();

	let open = $state(false);
	let searchTerm = $state('');
	let inputRef = $state<HTMLInputElement>(null!);

	// Keep searchTerm in sync with value only when the popover is closed (mount, external change, or close)
	$effect(() => {
		if (!open) {
			const matched = items.find((i) => i.value === value);
			searchTerm = matched ? matched.label : '';
		}
	});

	const filteredItems = $derived(
		searchTerm.trim() === ''
			? items
			: items.filter((item) =>
					item.label.toLowerCase().includes(searchTerm.trim().toLowerCase())
				)
	);

	function onSelect(item: T) {
		value = item.value;
		searchTerm = item.label;
		open = false;
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchTerm = target.value;
		open = true; // Open popover while typing

		// If input is completely empty, clear the value
		if (searchTerm.trim() === '') {
			value = '';
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger class="w-full">
		{#snippet child({ props })}
			<div class="relative w-full">
				<Input
					bind:ref={inputRef}
					{...props}
					{...controlProps}
					{...restProps}
					type="text"
					value={searchTerm}
					oninput={handleInput}
					onfocus={() => {
						open = true;
					}}
					onclick={(e) => {
						if (open) {
							e.stopPropagation();
						}
					}}
					placeholder={placeholder}
					disabled={disabled}
					class={cn("w-full pr-8", className)}
				/>
				<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground/50">
					<SearchIcon class="size-4" />
				</div>
			</div>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-[--bits-popover-anchor-width] p-1 bg-popover text-popover-foreground max-h-[300px] overflow-y-auto">
		<div class="flex flex-col gap-0.5">
			{#if filteredItems.length === 0}
				<div class="py-6 text-center text-sm text-muted-foreground">
					{emptyText}
				</div>
			{:else}
				{#each filteredItems as item (item.value)}
					<button
						type="button"
						class={cn(
							"relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground text-left",
							value === item.value && "bg-accent/50 font-medium"
						)}
						onpointerdown={(e) => {
							e.preventDefault();
							onSelect(item);
						}}
					>
						<span class="flex flex-1 gap-2 shrink-0 whitespace-nowrap">
							{item.label}
						</span>
						<span class="absolute end-2 flex size-3.5 items-center justify-center">
							{#if value === item.value}
								<CheckIcon class="size-4" />
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
