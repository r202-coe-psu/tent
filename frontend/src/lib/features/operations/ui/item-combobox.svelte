<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Combobox } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';
	import { qtyGt, qtyLte } from '$lib/utils/qty';
	import { filterStockFormItems, type StockFormItem } from '../domain/stock-form-items';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		items = [],
		value = $bindable(''),
		disabled = false,
		isLoading = false,
		balanceByItemId,
		disableWhenEmpty = false,
		formatBalanceUnit,
		placeholder = 'ค้นหา…',
		emptyText = 'ไม่พบสินค้า',
		createOption,
		onSelect,
		id,
		name,
		class: className,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedBy
	}: {
		items?: StockFormItem[];
		value?: string;
		disabled?: boolean;
		isLoading?: boolean;
		balanceByItemId?: ReadonlyMap<string, string>;
		disableWhenEmpty?: boolean;
		formatBalanceUnit?: (item: StockFormItem) => string;
		placeholder?: string;
		emptyText?: string;
		createOption?: Snippet<[{ query: string }]>;
		onSelect?: (item: StockFormItem | null) => void;
		id?: string;
		name?: string;
		class?: string;
		'aria-invalid'?: boolean | 'true' | 'false' | undefined;
		'aria-describedby'?: string | undefined;
	} = $props();

	let searchValue = $state('');
	let open = $state(false);

	const selectedItem = $derived(items.find((item) => item._id === value) ?? null);

	const filteredItems = $derived(filterStockFormItems(items, searchValue));

	const typeaheadItems = $derived(
		items.map((item) => ({
			value: item._id,
			label: item.name,
			disabled: isItemDisabled(item)
		}))
	);

	function balanceOf(item: StockFormItem): string {
		return balanceByItemId?.get(item._id) ?? '0';
	}

	function isItemDisabled(item: StockFormItem): boolean {
		if (!disableWhenEmpty || !balanceByItemId) return false;
		return qtyLte(balanceOf(item), 0);
	}

	function unitLabel(item: StockFormItem): string {
		return formatBalanceUnit?.(item) ?? item.unit;
	}

	function handleValueChange(next: string) {
		value = next;
		const item = items.find((i) => i._id === next) ?? null;
		if (item) searchValue = item.name;
		onSelect?.(item);
	}

	function clearSelection() {
		value = '';
		searchValue = '';
		onSelect?.(null);
	}

	function handleOpenChangeComplete(isOpen: boolean) {
		if (!isOpen) {
			searchValue = selectedItem?.name ?? '';
		}
	}
</script>

<Combobox.Root
	type="single"
	bind:value
	bind:open
	{disabled}
	{name}
	items={typeaheadItems}
	allowDeselect={false}
	inputValue={selectedItem?.name}
	onValueChange={handleValueChange}
	onOpenChangeComplete={handleOpenChangeComplete}
>
	<div class="relative w-full">
		<Combobox.Input
			{id}
			{placeholder}
			aria-invalid={ariaInvalid}
			aria-describedby={ariaDescribedBy}
			autocomplete="off"
			oninput={(e) => {
				searchValue = e.currentTarget.value;
			}}
			class={cn(
				'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 pr-20 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:font-bold disabled:text-muted-foreground disabled:opacity-100',
				className
			)}
		/>
		<div class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
			{#if selectedItem && !disabled}
				<Button
					type="button"
					variant="ghost"
					class="min-h-9 min-w-9 px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						clearSelection();
					}}
				>
					<span class="sr-only">ล้าง</span>
					<XIcon class="size-4" />
				</Button>
			{/if}
			<Combobox.Trigger
				class="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:pointer-events-none"
				{disabled}
			>
				<ChevronsUpDownIcon class="size-4 opacity-50" />
			</Combobox.Trigger>
		</div>
	</div>

	<Combobox.Portal>
		<Combobox.Content
			class="z-50 max-h-60 w-[var(--bits-combobox-anchor-width)] min-w-[var(--bits-combobox-anchor-width)] overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-xl outline-none"
			sideOffset={4}
		>
			<Combobox.Viewport class="max-h-56 overflow-y-auto">
				{#if isLoading}
					<div class="p-3 text-xs text-muted-foreground">กำลังโหลด…</div>
				{:else if filteredItems.length === 0 && !createOption}
					<div class="p-3 text-xs text-muted-foreground">{emptyText}</div>
				{:else}
					{#each filteredItems as item (item._id)}
						{@const bal = balanceOf(item)}
						{@const itemDisabled = isItemDisabled(item)}
						<Combobox.Item
							value={item._id}
							label={item.name}
							disabled={itemDisabled}
							class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-muted"
						>
							{#snippet children({ selected })}
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span
											class="truncate font-semibold text-foreground {itemDisabled
												? 'opacity-50'
												: ''}"
										>
											{item.name}
										</span>
										{#if selected}
											<CheckIcon class="size-3.5 shrink-0 text-primary" />
										{/if}
									</div>
									{#if item.sku}
										<div class="font-mono text-2xs text-muted-foreground">{item.sku}</div>
									{/if}
								</div>
								{#if balanceByItemId}
									<span
										class="shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold {qtyGt(bal, 0)
											? 'border-primary/20 bg-primary/10 text-primary'
											: 'border-destructive/20 bg-destructive/10 text-destructive'}"
									>
										{bal}
										{unitLabel(item)}
									</span>
								{/if}
							{/snippet}
						</Combobox.Item>
					{/each}
					{#if createOption}
						{@render createOption({ query: searchValue })}
					{:else if filteredItems.length === 0}
						<div class="p-3 text-xs text-muted-foreground">{emptyText}</div>
					{/if}
				{/if}
			</Combobox.Viewport>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
