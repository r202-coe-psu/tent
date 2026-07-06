<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';

	interface Props {
		name: string;
		value?: string;
		placeholder?: string;
		options: { label: string; value: string }[];
	}

	let { name, value = $bindable(''), placeholder = 'เลือก...', options = [] }: Props = $props();

	let open = $state(false);
	let searchValue = $state('');

	let filteredOptions = $derived(
		options.filter((opt) => opt.label.toLowerCase().includes(searchValue.toLowerCase()))
	);

	function handleSelect(optValue: string) {
		value = optValue;
		open = false;
		searchValue = '';
	}

	let selectedLabel = $derived(options.find((o) => o.value === value)?.label || placeholder);
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="flex h-10 w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {value
			? 'text-foreground'
			: 'text-muted-foreground'}"
	>
		{selectedLabel}
		<ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
	</Popover.Trigger>
	<Popover.Content class="w-[var(--radix-popover-trigger-width)] p-0" align="start">
		<div class="flex flex-col">
			<div class="border-b px-3">
				<Input
					type="text"
					placeholder="ค้นหา..."
					bind:value={searchValue}
					class="h-9 w-full border-0 px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
				/>
			</div>
			<div class="custom-scrollbar max-h-60 overflow-y-auto p-1">
				{#if filteredOptions.length === 0}
					<div class="py-6 text-center text-sm text-muted-foreground">ไม่พบข้อมูล</div>
				{:else}
					{#each filteredOptions as opt (opt.value)}
						<button
							type="button"
							class="relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
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
				{/if}
			</div>
		</div>
	</Popover.Content>
</Popover.Root>

<input type="hidden" {name} {value} />
