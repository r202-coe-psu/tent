<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Search from '@lucide/svelte/icons/search';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		LEDGER_RANGE_LABELS,
		type LedgerRangePreset,
		type LedgerUrlState
	} from './ledger-url-state';
	import { LEDGER_GROUP_LABELS, type LedgerTypeFilter } from './ledger-view';

	let {
		state: filter,
		onchange,
		onexport
	}: {
		state: LedgerUrlState;
		onchange: (patch: Partial<LedgerUrlState>) => void;
		onexport: () => void;
	} = $props();

	const RANGES = Object.keys(LEDGER_RANGE_LABELS) as LedgerRangePreset[];
	const TYPES: { value: LedgerTypeFilter; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'in', label: LEDGER_GROUP_LABELS.in },
		{ value: 'out', label: LEDGER_GROUP_LABELS.out },
		{ value: 'adjust', label: LEDGER_GROUP_LABELS.adjust },
		{ value: 'transfer', label: LEDGER_GROUP_LABELS.transfer }
	];

	// Typing is debounced into the URL; the box itself stays responsive.
	const SEARCH_DEBOUNCE_MS = 300;
	let text = $state('');
	let committed = '';
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Follow external changes to `q` (back/forward). Not a `$derived`: that would overwrite
	// characters typed while the URL update is still in flight; `committed` guards that.
	$effect(() => {
		if (filter.q !== committed) {
			text = filter.q;
			committed = filter.q;
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

	function chipClass(active: boolean) {
		return [
			'inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none',
			active
				? 'border-2 border-[#0284C7] bg-sky-50 text-sky-900'
				: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
		].join(' ');
	}

	const DATE_CLASS =
		'min-h-11 rounded-lg border-slate-300 bg-white text-base shadow-2xs md:w-40 md:text-sm';
</script>

<div class="flex flex-col gap-2.5 border-b border-slate-200/80 p-3 md:p-4">
	<div class="flex flex-wrap items-center gap-2.5">
		<Select.Root
			type="single"
			value={filter.range}
			onValueChange={(v) => v && onchange({ range: v as LedgerRangePreset })}
		>
			<Select.Trigger
				class="min-h-11 w-full rounded-lg border-slate-300 bg-white text-sm shadow-2xs sm:w-52"
				aria-label="ช่วงเวลา"
			>
				<span class="truncate">
					<span class="text-slate-500">ช่วงเวลา:</span>
					{LEDGER_RANGE_LABELS[filter.range]}
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each RANGES as range (range)}
					<Select.Item value={range} label={LEDGER_RANGE_LABELS[range]}>
						{LEDGER_RANGE_LABELS[range]}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		{#if filter.range === 'custom'}
			<Input
				type="date"
				value={filter.from}
				max={filter.to || undefined}
				onchange={(e) => onchange({ from: e.currentTarget.value })}
				aria-label="ตั้งแต่วันที่"
				class={DATE_CLASS}
			/>
			<span class="text-sm text-slate-500" aria-hidden="true">ถึง</span>
			<Input
				type="date"
				value={filter.to}
				min={filter.from || undefined}
				onchange={(e) => onchange({ to: e.currentTarget.value })}
				aria-label="ถึงวันที่"
				class={DATE_CLASS}
			/>
		{/if}

		<div class="relative min-w-52 flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
				aria-hidden="true"
			/>
			<Input
				type="search"
				value={text}
				oninput={(e) => onSearchInput(e.currentTarget.value)}
				placeholder="ค้นหาสินค้า / ผู้รับ / เลขอ้างอิง"
				aria-label="ค้นหาสินค้า ผู้รับ หรือเลขอ้างอิง"
				class="min-h-11 w-full rounded-lg border-slate-300 bg-white pl-9 text-base shadow-2xs md:text-sm"
			/>
		</div>

		<Button
			type="button"
			variant="outline"
			onclick={onexport}
			class="min-h-11 gap-2 rounded-lg border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 shadow-2xs"
		>
			<Download class="h-4 w-4" aria-hidden="true" />
			ส่งออก CSV
		</Button>
	</div>

	<div role="group" aria-label="ประเภทรายการ" class="flex scrollbar-none gap-1.5 overflow-x-auto">
		{#each TYPES as type (type.value)}
			<button
				type="button"
				aria-pressed={filter.type === type.value}
				onclick={() => onchange({ type: type.value })}
				class={chipClass(filter.type === type.value)}
			>
				{type.label}
			</button>
		{/each}
	</div>
</div>
