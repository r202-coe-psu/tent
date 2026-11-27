<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { SelectFilter } from './master-view';

	let {
		q = $bindable(''),
		searchLabel,
		searchPlaceholder,
		selects = [],
		onselect,
		showDeactivated = $bindable(false),
		switchId
	}: {
		q?: string;
		searchLabel: string;
		searchPlaceholder: string;
		selects?: SelectFilter[];
		onselect: (id: string, value: string) => void;
		showDeactivated?: boolean;
		switchId: string;
	} = $props();

	const TRIGGER_CLASS =
		'h-10 w-full rounded-lg border-input bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-10';

	function labelOf(filter: SelectFilter): string {
		if (filter.value === 'all') return filter.allLabel ?? 'ทั้งหมด';
		return filter.options.find((o) => o.value === filter.value)?.label ?? filter.value;
	}
</script>

<div class="space-y-3 border-b border-slate-200/80 p-3 md:p-4">
	<div class="relative w-full">
		<Search
			class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
			aria-hidden="true"
		/>
		<Input
			type="search"
			bind:value={q}
			placeholder={searchPlaceholder}
			aria-label={searchLabel}
			class="h-10 w-full rounded-lg border-input bg-white pl-9 text-sm shadow-2xs placeholder:text-slate-400"
		/>
	</div>

	<div class="flex flex-wrap items-end gap-3">
		{#each selects as filter (filter.id)}
			<div class="flex min-w-[140px] flex-1 flex-col gap-1.5 md:w-56 md:flex-none">
				<label for="{switchId}-{filter.id}" class="text-xs font-semibold text-slate-600">
					{filter.prefix}
				</label>
				<Select.Root
					type="single"
					value={filter.value}
					onValueChange={(v) => v && onselect(filter.id, v)}
				>
					<Select.Trigger
						id="{switchId}-{filter.id}"
						class={TRIGGER_CLASS}
						aria-label={filter.label}
					>
						<span class="truncate">{labelOf(filter)}</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label={filter.allLabel ?? 'ทั้งหมด'}>
							{filter.allLabel ?? 'ทั้งหมด'}
						</Select.Item>
						{#each filter.options as option (option.value)}
							<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/each}

		<div class="flex min-h-10 items-center gap-2.5 px-1">
			<Switch id={switchId} bind:checked={showDeactivated} />
			<Label for={switchId} class="cursor-pointer text-sm whitespace-nowrap text-slate-700">
				แสดงที่ปิดใช้งาน
			</Label>
		</div>
	</div>
</div>
