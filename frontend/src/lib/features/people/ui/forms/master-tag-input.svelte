<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';
	import {
		formatMasterLabelByCode,
		resolveMasterCode,
		type MasterDataItem
	} from '$lib/features/master-data';

	/**
	 * Tag autocomplete over a master list (#649): pick items by `code`, or add
	 * off-list free text. `value` holds codes and free-text entries side by side.
	 */
	let {
		id,
		value = $bindable<string[]>([]),
		items = [],
		disabled = false,
		placeholder = 'เลือกหรือพิมพ์เพิ่ม',
		searchPlaceholder = 'ค้นหา...',
		emptyText = 'ไม่พบรายการ',
		listLabel = 'รายการที่เลือก'
	}: {
		id?: string;
		value?: string[];
		items?: readonly MasterDataItem[];
		disabled?: boolean;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		/** Screen-reader name of the selected-tags list, e.g. "โรคประจำตัวที่เลือก". */
		listLabel?: string;
	} = $props();

	let open = $state(false);
	let search = $state('');

	const activeItems = $derived(items.filter((i) => i.status !== 'inactive'));
	const selected = $derived(new Set(value));
	/** Free text to offer as a new tag — commas would split it on save. */
	const freeText = $derived(search.replace(/,/g, ' ').trim());
	const canAddFreeText = $derived(
		freeText.length > 0 && !selected.has(resolveMasterCode(freeText, items))
	);

	function toggle(code: string) {
		value = selected.has(code) ? value.filter((v) => v !== code) : [...value, code];
	}

	function addFreeText() {
		const token = resolveMasterCode(freeText, items);
		if (token && !selected.has(token)) value = [...value, token];
		search = '';
	}

	function remove(token: string) {
		value = value.filter((v) => v !== token);
	}
</script>

<div class="space-y-2">
	{#if value.length > 0}
		<ul class="flex flex-wrap gap-1.5" aria-label={listLabel}>
			{#each value as token (token)}
				{@const label = formatMasterLabelByCode(token, items) || token}
				<li
					class="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pr-0.5 pl-3 text-sm font-semibold text-slate-800"
				>
					<span>{label}</span>
					<button
						type="button"
						{disabled}
						onclick={() => remove(token)}
						class="inline-flex size-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
					>
						<X class="size-4" />
						<span class="sr-only">ลบ {label}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					{id}
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					{disabled}
					class="min-h-12 w-full justify-start gap-2 text-sm font-normal text-muted-foreground"
				>
					<Plus class="size-4 shrink-0" />
					<span class="truncate">{placeholder}</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="start" class="w-(--bits-floating-anchor-width) min-w-64 p-0">
			<Command.Root>
				<Command.Input
					placeholder={searchPlaceholder}
					value={search}
					oninput={(e) => (search = e.currentTarget.value)}
				/>
				<Command.List>
					<Command.Empty>{emptyText}</Command.Empty>
					{#if canAddFreeText}
						<!-- forceMount: the search may hold a comma the add option strips, so
						     bits-ui's filter would otherwise hide it. -->
						<Command.Group forceMount>
							<Command.Item value="__add__{freeText}" forceMount onSelect={addFreeText}>
								<Plus class="size-4" />
								<span>เพิ่ม “{freeText}”</span>
							</Command.Item>
						</Command.Group>
					{/if}
					<Command.Group>
						{#each activeItems as item (item.code)}
							<Command.Item
								value={item.code}
								keywords={[item.label_th, item.label_en]}
								onSelect={() => toggle(item.code)}
							>
								<CheckIcon class={cn('size-4', !selected.has(item.code) && 'text-transparent')} />
								<span>{formatMasterLabelByCode(item.code, items)}</span>
							</Command.Item>
						{/each}
					</Command.Group>
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
</div>
