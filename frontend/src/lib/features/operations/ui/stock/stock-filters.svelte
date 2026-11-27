<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import DisabledReason from './disabled-reason.svelte';
	import { INCOMING_NO_STORAGE_HINT, INCOMING_SELF_PURCHASED_HINT } from './hints';
	import type { StockSort, StockStatusFilter } from './stock-view';

	type Option = { value: string; label: string };
	type LocationOption = Option & { hint?: string };

	let {
		q,
		cat,
		loc,
		sort,
		all,
		incoming = false,
		incomingDisabled = false,
		selfPurchased = false,
		status,
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
		/** "รวมของที่กำลังมา" (#1153): add approved donations + shipped transfers to the remaining qty. */
		incoming?: boolean;
		/** A storage point is filtered: incoming goods have no place yet, so the switch is off. */
		incomingDisabled?: boolean;
		/** "ซื้อเอง": only items with a self-purchased lot still on hand. */
		selfPurchased?: boolean;
		/** Current status filter; the "มีวันหมดอายุ" switch is on while it is `has_expiry`. */
		status: StockStatusFilter | 'all';
		categories: Option[];
		locations: LocationOption[];
		/** System admins can sum every shelter's stock. */
		showOverall?: boolean;
		canShowOverall?: boolean;
		onchange: (patch: {
			q?: string;
			cat?: string;
			loc?: string;
			sort?: StockSort;
			all?: boolean;
			incoming?: boolean;
			selfPurchased?: boolean;
			status?: StockStatusFilter | 'all';
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

	const TRIGGER_CLASS =
		'h-10 w-full rounded-lg border-input bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-10 sm:w-52';
	const FIELD_CLASS = 'flex min-w-[140px] flex-1 flex-col gap-1.5 sm:flex-none';
	const LABEL_CLASS = 'text-xs font-semibold text-slate-600';
</script>

<div class="flex flex-col gap-3 border-b border-slate-200/80 p-3 md:p-4">
	<div class="relative w-full">
		<Search
			class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
			aria-hidden="true"
		/>
		<Input
			type="search"
			value={text}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			placeholder="ค้นหาชื่อ / SKU / สแกนบาร์โค้ด"
			aria-label="ค้นหาชื่อ, SKU หรือบาร์โค้ด"
			class="h-10 w-full rounded-lg border-input bg-white pl-9 text-sm shadow-2xs placeholder:text-slate-400"
		/>
	</div>

	<div class="flex flex-wrap items-end gap-3">
		<div class={FIELD_CLASS}>
			<label for="stock-category-filter" class={LABEL_CLASS}>หมวด</label>
			<Select.Root type="single" value={cat} onValueChange={(v) => v && onchange({ cat: v })}>
				<Select.Trigger id="stock-category-filter" class={TRIGGER_CLASS} aria-label="กรองหมวดหมู่">
					<span class="truncate">{catLabel}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="ทั้งหมด">ทั้งหมด</Select.Item>
					{#each categories as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class={FIELD_CLASS}>
			<label for="stock-location-filter" class={LABEL_CLASS}>ที่เก็บ</label>
			<Select.Root type="single" value={loc} onValueChange={(v) => v && onchange({ loc: v })}>
				<Select.Trigger id="stock-location-filter" class={TRIGGER_CLASS} aria-label="กรองที่เก็บ">
					<span class="truncate">{locLabel}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="ทุกจุด">ทุกจุด</Select.Item>
					{#each locations as option (option.value)}
						<Select.Item value={option.value} label={option.label}>
							<span class="flex min-w-0 flex-col">
								<span class="truncate">{option.label}</span>
								{#if option.hint}
									<span class="truncate text-xs text-muted-foreground">{option.hint}</span>
								{/if}
							</span>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class={FIELD_CLASS}>
			<label for="stock-sort-filter" class={LABEL_CLASS}>เรียง</label>
			<Select.Root
				type="single"
				value={sort}
				onValueChange={(v) => {
					const next = SORT_OPTIONS.find((o) => o.value === v);
					if (next) onchange({ sort: next.value });
				}}
			>
				<Select.Trigger id="stock-sort-filter" class={TRIGGER_CLASS} aria-label="เรียงลำดับ">
					<span class="truncate">{sortLabel}</span>
				</Select.Trigger>
				<Select.Content>
					{#each SORT_OPTIONS as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-x-6 gap-y-1">
		<div class="flex min-h-10 items-center gap-2.5 px-1">
			<Switch id="stock-all-catalog" checked={all} onCheckedChange={(v) => onchange({ all: v })} />
			<Label
				for="stock-all-catalog"
				class="cursor-pointer text-sm whitespace-nowrap text-slate-700"
			>
				ทั้งแคตตาล็อก
			</Label>
		</div>

		<div class="flex min-h-11 items-center gap-2.5 px-1">
			<Switch
				id="stock-self-purchased"
				checked={selfPurchased}
				onCheckedChange={(v) => onchange({ selfPurchased: v })}
			/>
			<Label
				for="stock-self-purchased"
				class="cursor-pointer text-sm whitespace-nowrap text-slate-700"
			>
				ซื้อเอง
			</Label>
		</div>

		<DisabledReason
			reason={incomingDisabled
				? selfPurchased
					? INCOMING_SELF_PURCHASED_HINT
					: INCOMING_NO_STORAGE_HINT
				: undefined}
		>
			<div class="flex min-h-11 items-center gap-2.5 px-1">
				<Switch
					id="stock-incoming"
					checked={incoming && !incomingDisabled}
					disabled={incomingDisabled}
					onCheckedChange={(v) => onchange({ incoming: v })}
				/>
				<Label
					for="stock-incoming"
					class="text-sm whitespace-nowrap {incomingDisabled
						? 'cursor-not-allowed text-slate-400'
						: 'cursor-pointer text-slate-700'}"
				>
					รวมของที่กำลังมา
				</Label>
			</div>
		</DisabledReason>

		<div class="flex min-h-11 items-center gap-2.5 px-1">
			<Switch
				id="stock-has-expiry"
				checked={status === 'has_expiry'}
				onCheckedChange={(v) => onchange({ status: v ? 'has_expiry' : 'all' })}
			/>
			<Label for="stock-has-expiry" class="cursor-pointer text-sm whitespace-nowrap text-slate-700">
				มีวันหมดอายุ
			</Label>
		</div>
	</div>

	{#if canShowOverall}
		<div class="flex min-h-11 items-center gap-2.5 px-1">
			<Checkbox id="show-overall" bind:checked={showOverall} />
			<Label for="show-overall" class="cursor-pointer text-sm font-semibold text-slate-700">
				แสดงยอดรวมทุกศูนย์
			</Label>
		</div>
	{/if}
</div>
