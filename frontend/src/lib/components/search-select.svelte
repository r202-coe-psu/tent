<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Input } from '$lib/components/ui/input';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { cn, listOptionActiveClass, listOptionHoverClass } from '$lib/utils/shadcn.js';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Loader from '@lucide/svelte/icons/loader';

	interface Props {
		name: string;
		id?: string;
		value?: string;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		loadingText?: string;
		class?: string;
		disabled?: boolean;
		loading?: boolean;
		maxResults?: number;
		controlProps?: Record<string, unknown>;
		options: { label: string; value: string }[];
	}

	let {
		name,
		id,
		value = $bindable(''),
		placeholder = 'เลือก...',
		searchPlaceholder = 'ค้นหา...',
		emptyText = 'ไม่พบข้อมูล',
		loadingText = 'กำลังโหลด...',
		class: className,
		disabled = false,
		loading = false,
		maxResults = 100,
		controlProps = {},
		options = []
	}: Props = $props();

	/** Tailwind `max-sm` — bottom sheet on narrow viewports, Popover above. */
	const isMobileViewport = new IsMobile(640);

	let open = $state(false);
	let searchValue = $state('');
	let triggerWidth = $state(0);

	let matchedOptions = $derived(
		options.filter((opt) => opt.label.toLowerCase().includes(searchValue.toLowerCase()))
	);
	let filteredOptions = $derived(matchedOptions.slice(0, maxResults));
	let truncatedCount = $derived(matchedOptions.length - filteredOptions.length);

	function handleSelect(optValue: string) {
		value = optValue;
		open = false;
		searchValue = '';
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) searchValue = '';
	}

	let selectedLabel = $derived(
		loading ? loadingText : options.find((o) => o.value === value)?.label || placeholder
	);

	const triggerClass = $derived(
		cn(
			'flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			value && !loading ? 'text-foreground' : 'text-muted-foreground',
			className
		)
	);
</script>

{#snippet searchField(sticky = false)}
	<div class={cn('border-b bg-background px-3', sticky && 'sticky top-0 z-10 shrink-0')}>
		<Input
			type="text"
			placeholder={searchPlaceholder}
			bind:value={searchValue}
			class="h-11 w-full border-0 px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
		/>
	</div>
{/snippet}

{#snippet optionsList(scrollClass: string)}
	<div class={cn('custom-scrollbar overflow-y-auto p-1', scrollClass)}>
		{#if filteredOptions.length === 0}
			<div class="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
		{:else}
			{#each filteredOptions as opt (opt.value)}
				<button
					type="button"
					class={cn(
						'relative flex w-full cursor-default items-center rounded-sm py-2.5 pr-2 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 sm:py-1.5',
						listOptionHoverClass,
						listOptionActiveClass
					)}
					onclick={() => handleSelect(opt.value)}
				>
					{#if value === opt.value}
						<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
							<Check class="h-4 w-4" />
						</span>
					{/if}
					{opt.label}
				</button>
			{/each}
			{#if truncatedCount > 0}
				<div class="px-3 py-2 text-center text-xs text-muted-foreground">
					พิมพ์เพิ่มเพื่อค้นหาอีก {truncatedCount} รายการ
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#if isMobileViewport.current}
	<Sheet.Root bind:open onOpenChange={handleOpenChange}>
		<div bind:clientWidth={triggerWidth} class="w-full">
			<Sheet.Trigger
				{...controlProps}
				id={id || name}
				data-name={name}
				type="button"
				disabled={disabled || loading}
				aria-busy={loading}
				class={triggerClass}
			>
				<span class={cn('truncate', !value && !loading && 'text-xs')}>
					{selectedLabel}
				</span>
				{#if loading}
					<Loader class="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
				{:else}
					<ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
				{/if}
			</Sheet.Trigger>
		</div>
		<Sheet.Content
			side="bottom"
			class="flex h-[70dvh] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)]"
		>
			<Sheet.Header class="shrink-0 border-b px-4 py-3 pr-12 text-left">
				<Sheet.Title class="text-base font-semibold">{placeholder}</Sheet.Title>
				<Sheet.Description class="sr-only">{searchPlaceholder}</Sheet.Description>
			</Sheet.Header>
			{@render searchField(true)}
			{@render optionsList('min-h-0 flex-1')}
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Popover.Root bind:open onOpenChange={handleOpenChange}>
		<div bind:clientWidth={triggerWidth} class="w-full">
			<Popover.Trigger
				{...controlProps}
				id={id || name}
				data-name={name}
				type="button"
				disabled={disabled || loading}
				aria-busy={loading}
				class={triggerClass}
			>
				<span class={cn('truncate', !value && !loading && 'text-xs')}>
					{selectedLabel}
				</span>
				{#if loading}
					<Loader class="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
				{:else}
					<ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
				{/if}
			</Popover.Trigger>
		</div>
		<Popover.Content class="w-auto p-0" align="start">
			<div style="width: {triggerWidth}px" class="flex flex-col">
				{@render searchField(false)}
				{@render optionsList('max-h-60')}
			</div>
		</Popover.Content>
	</Popover.Root>
{/if}

<input type="hidden" {name} {value} />
