<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Search from '@lucide/svelte/icons/search';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { DateRangePicker } from '$lib/components/ui/date-picker/index.js';
	import {
		LEDGER_RANGE_LABELS,
		type LedgerRangePreset,
		type LedgerUrlState
	} from './ledger-url-state';
	import { adjustReasonSchema } from '../../domain/operations';
	import {
		ADJUST_REASON_LABELS,
		LEDGER_GROUP_LABELS,
		type LedgerReasonFilter,
		type LedgerTypeFilter
	} from './ledger-view';

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
		{ value: 'transfer', label: LEDGER_GROUP_LABELS.transfer },
		{ value: 'self_purchased', label: LEDGER_GROUP_LABELS.self_purchased }
	];

	// CR-143 FR-C5 — reason chips appear with the adjust group (`merge` included: it is
	// written by the merge flow and must stay filterable).
	const REASONS: { value: LedgerReasonFilter; label: string }[] = [
		{ value: 'all', label: 'ทุกเหตุผล' },
		...adjustReasonSchema.options.map((value) => ({ value, label: ADJUST_REASON_LABELS[value] }))
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

	const typeLabel = $derived(TYPES.find((t) => t.value === filter.type)?.label ?? 'ทั้งหมด');
	const reasonLabel = $derived(
		REASONS.find((r) => r.value === filter.reason)?.label ?? 'ทุกเหตุผล'
	);

	const DATE_CLASS = 'h-10 rounded-lg border-input bg-white text-sm shadow-2xs md:w-64';
	const LABEL_CLASS = 'text-xs font-semibold text-slate-600';
</script>

<div class="flex flex-col gap-3 border-b border-slate-200/80 p-3 md:p-4">
	<div class="relative w-full">
		<Search
			class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
			aria-hidden="true"
		/>
		<label for="ledger-search" class="sr-only">ค้นหา</label>
		<Input
			id="ledger-search"
			type="search"
			value={text}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			placeholder="ค้นหาสินค้า / ผู้รับ / เลขอ้างอิง"
			aria-label="ค้นหาสินค้า ผู้รับ หรือเลขอ้างอิง"
			class="h-10 w-full rounded-lg border-input bg-white pl-9 text-sm shadow-2xs placeholder:text-slate-400"
		/>
	</div>

	<div class="flex flex-wrap items-end gap-3">
		<div class="flex flex-col gap-1.5">
			<label for="ledger-range-filter" class={LABEL_CLASS}>ช่วงเวลา</label>
			<Select.Root
				type="single"
				value={filter.range}
				onValueChange={(v) => v && onchange({ range: v as LedgerRangePreset })}
			>
				<Select.Trigger
					id="ledger-range-filter"
					class="h-10 w-full rounded-lg border-input bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-10 sm:w-52"
					aria-label="ช่วงเวลา"
				>
					<span class="truncate">{LEDGER_RANGE_LABELS[filter.range]}</span>
				</Select.Trigger>
				<Select.Content>
					{#each RANGES as range (range)}
						<Select.Item value={range} label={LEDGER_RANGE_LABELS[range]}>
							{LEDGER_RANGE_LABELS[range]}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="flex flex-col gap-1.5">
			<label for="ledger-type-filter" class={LABEL_CLASS}>ประเภท</label>
			<Select.Root
				type="single"
				value={filter.type}
				onValueChange={(v) => v && onchange({ type: v as LedgerTypeFilter, reason: 'all' })}
			>
				<Select.Trigger
					id="ledger-type-filter"
					class="h-10 w-full rounded-lg border-input bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-10 sm:w-48"
					aria-label="ประเภทรายการ"
				>
					<span class="truncate">{typeLabel}</span>
				</Select.Trigger>
				<Select.Content>
					{#each TYPES as type (type.value)}
						<Select.Item value={type.value} label={type.label}>{type.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if filter.type === 'adjust'}
			<div class="flex flex-col gap-1.5">
				<label for="ledger-reason-filter" class={LABEL_CLASS}>เหตุผล</label>
				<Select.Root
					type="single"
					value={filter.reason}
					onValueChange={(v) => v && onchange({ reason: v as LedgerReasonFilter })}
				>
					<Select.Trigger
						id="ledger-reason-filter"
						class="h-10 w-full rounded-lg border-input bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-10 sm:w-48"
						aria-label="เหตุผลการปรับยอด"
					>
						<span class="truncate">{reasonLabel}</span>
					</Select.Trigger>
					<Select.Content>
						{#each REASONS as reason (reason.value)}
							<Select.Item value={reason.value} label={reason.label}>{reason.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}

		{#if filter.range === 'custom'}
			<div class="flex flex-col gap-1.5">
				<label for="ledger-range-filter" class={LABEL_CLASS}>ช่วงวันที่</label>
				<DateRangePicker
					id="ledger-range-filter"
					ariaLabel="ช่วงวันที่"
					from={filter.from}
					to={filter.to}
					class={DATE_CLASS}
					onRangeChange={(next) => onchange({ from: next.from, to: next.to })}
				/>
			</div>
		{/if}

		<Button
			type="button"
			variant="outline"
			onclick={onexport}
			class="ml-auto h-10 gap-2 rounded-lg border-input bg-white px-3.5 text-sm font-semibold text-slate-800 shadow-2xs"
		>
			<Download class="h-4 w-4" aria-hidden="true" />
			ส่งออก CSV
		</Button>
	</div>
</div>
