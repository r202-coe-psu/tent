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

	const TRIGGER_CLASS = 'min-h-11 w-full rounded-lg border-slate-300 bg-white text-sm shadow-2xs';

	function labelOf(filter: SelectFilter): string {
		if (filter.value === 'all') return filter.allLabel ?? 'ทั้งหมด';
		return filter.options.find((o) => o.value === filter.value)?.label ?? filter.value;
	}
</script>

<div
	class="grid grid-cols-2 gap-2.5 border-b border-slate-200/80 p-3 md:flex md:flex-wrap md:items-center md:p-4"
>
	<div class="relative col-span-2 md:min-w-64 md:flex-1">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
			aria-hidden="true"
		/>
		<Input
			type="search"
			bind:value={q}
			placeholder={searchPlaceholder}
			aria-label={searchLabel}
			class="min-h-11 w-full rounded-lg border-slate-300 bg-white pl-9 text-base shadow-2xs md:text-sm"
		/>
	</div>

	{#each selects as filter (filter.id)}
		<div class="md:w-56">
			<Select.Root
				type="single"
				value={filter.value}
				onValueChange={(v) => v && onselect(filter.id, v)}
			>
				<Select.Trigger class={TRIGGER_CLASS} aria-label={filter.label}>
					<span class="truncate">
						<span class="text-slate-500">{filter.prefix}:</span>
						{labelOf(filter)}
					</span>
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

	<div class="col-span-2 flex min-h-11 items-center gap-2.5 px-1 md:col-span-1">
		<Switch id={switchId} bind:checked={showDeactivated} />
		<Label for={switchId} class="cursor-pointer text-sm whitespace-nowrap text-slate-700">
			แสดงที่ปิดใช้งาน
		</Label>
	</div>
</div>
