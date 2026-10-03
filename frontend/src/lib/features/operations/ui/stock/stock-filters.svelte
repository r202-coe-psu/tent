<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { StockSort } from './stock-view';

	type Option = { value: string; label: string };

	let {
		q,
		cat,
		loc,
		sort,
		all,
		categories,
		locations,
		showOverall = $bindable(false),
		canShowOverall = false,
		onchange
	}: {
		q: string;
		cat: string;
		loc: string;
		sort: StockSort;
		/** "ทั้งแคตตาล็อก": include items this shelter never received. */
		all: boolean;
		categories: Option[];
		locations: Option[];
		/** System admins can sum every shelter's stock. */
		showOverall?: boolean;
		canShowOverall?: boolean;
		onchange: (patch: {
			q?: string;
			cat?: string;
			loc?: string;
			sort?: StockSort;
			all?: boolean;
		}) => void;
	} = $props();

	const SORT_OPTIONS: { value: StockSort; label: string }[] = [
		{ value: 'urgency', label: 'เร่งด่วนก่อน' },
		{ value: 'name', label: 'ชื่อ ก–ฮ' },
		{ value: 'qty', label: 'คงเหลือน้อยก่อน' }
	];

	const catLabel = $derived(categories.find((o) => o.value === cat)?.label ?? 'ทั้งหมด');
	const locLabel = $derived(locations.find((o) => o.value === loc)?.label ?? 'ทุกจุด');
	const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'เร่งด่วนก่อน');

	// Typing is debounced into the URL; the box itself stays responsive.
	const SEARCH_DEBOUNCE_MS = 300;
	let text = $state('');
	let committed = '';
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Follow external changes to `q` (clear-filters, back/forward). Not a `$derived(q)`: that would
	// overwrite characters typed while the URL update is still in flight; `committed` guards that.
	$effect(() => {
		if (q !== committed) {
			text = q;
			committed = q;
		}
	});
	$effect(() => () => clearTimeout(timer));

	function onSearchInput(value: string) {
		text = value;
		clearTimeout(timer);
		timer = setTimeout(() => {
			committed = value;
			onchange({ q: value });
		}, SEARCH_DEBOUNCE_MS);
	}

	const TRIGGER_CLASS = 'min-h-11 w-full rounded-lg border-slate-300 bg-white text-sm shadow-2xs';
</script>

<div
	class="grid grid-cols-2 gap-2.5 border-b border-slate-200/80 p-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:p-4 lg:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_auto]"
>
	<div class="relative col-span-2 md:col-span-4 lg:col-span-1">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
			aria-hidden="true"
		/>
		<Input
			type="search"
			value={text}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			placeholder="ค้นหาชื่อ / SKU / สแกนบาร์โค้ด"
			aria-label="ค้นหาชื่อ, SKU หรือบาร์โค้ด"
			class="min-h-11 w-full rounded-lg border-slate-300 bg-white pl-9 text-base shadow-2xs md:text-sm"
		/>
	</div>

	<Select.Root type="single" value={cat} onValueChange={(v) => v && onchange({ cat: v })}>
		<Select.Trigger class={TRIGGER_CLASS} aria-label="กรองหมวดหมู่">
			<span class="truncate"><span class="text-slate-500">หมวด:</span> {catLabel}</span>
		</Select.Trigger>
		<Select.Content>
			<Select.Item value="all" label="ทั้งหมด">ทั้งหมด</Select.Item>
			{#each categories as option (option.value)}
				<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Select.Root type="single" value={loc} onValueChange={(v) => v && onchange({ loc: v })}>
		<Select.Trigger class={TRIGGER_CLASS} aria-label="กรองที่เก็บ">
			<span class="truncate"><span class="text-slate-500">ที่เก็บ:</span> {locLabel}</span>
		</Select.Trigger>
		<Select.Content>
			<Select.Item value="all" label="ทุกจุด">ทุกจุด</Select.Item>
			{#each locations as option (option.value)}
				<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Select.Root
		type="single"
		value={sort}
		onValueChange={(v) => {
			const next = SORT_OPTIONS.find((o) => o.value === v);
			if (next) onchange({ sort: next.value });
		}}
	>
		<Select.Trigger class={TRIGGER_CLASS} aria-label="เรียงลำดับ">
			<span class="truncate"><span class="text-slate-500">เรียง:</span> {sortLabel}</span>
		</Select.Trigger>
		<Select.Content>
			{#each SORT_OPTIONS as option (option.value)}
				<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<div class="flex min-h-11 items-center gap-2.5 px-1">
		<Switch id="stock-all-catalog" checked={all} onCheckedChange={(v) => onchange({ all: v })} />
		<Label for="stock-all-catalog" class="cursor-pointer text-sm whitespace-nowrap text-slate-700">
			ทั้งแคตตาล็อก
		</Label>
	</div>

	{#if canShowOverall}
		<div class="col-span-2 flex min-h-11 items-center gap-2.5 px-1 md:col-span-4 lg:col-span-5">
			<Checkbox id="show-overall" bind:checked={showOverall} />
			<Label for="show-overall" class="cursor-pointer text-sm font-semibold text-slate-700">
				แสดงยอดรวมทุกศูนย์
			</Label>
		</div>
	{/if}
</div>
