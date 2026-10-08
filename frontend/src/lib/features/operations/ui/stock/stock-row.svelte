<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import RowActions from './row-actions.svelte';
	import StatusBadges from './status-badges.svelte';
	import StockBar from './stock-bar.svelte';
	import { formatThresholdLine } from './stock-bar';
	import { expiryLabel, statusBadges, type StockDisplayRow } from './stock-view';

	let {
		row,
		readonly = false,
		offline = false,
		canDistribute = true,
		onopen,
		onreceive,
		ondistribute
	}: {
		row: StockDisplayRow;
		/** Cross-shelter totals are view-only: no opening the item, no receive/distribute. */
		readonly?: boolean;
		/** Session expired: the row stays openable but its receive / distribute buttons are off. */
		offline?: boolean;
		/** False when user lacks warehouse_staff capability in the active shelter. */
		canDistribute?: boolean;
		onopen: (row: StockDisplayRow) => void;
		onreceive: (row: StockDisplayRow) => void;
		ondistribute: (row: StockDisplayRow) => void;
	} = $props();

	const badges = $derived(statusBadges(row));
	const expiry = $derived(expiryLabel(row.earliestExpiry, row.expiryState));
	const caption = $derived(formatThresholdLine(row.reorderThreshold, row.unitLabel, row.coverDays));

	const EXPIRY_CLASS = {
		critical: 'text-red-700',
		warning: 'text-amber-700',
		muted: 'text-slate-400',
		default: 'text-slate-900'
	};
</script>

<Table.Row
	class="align-top transition-colors {readonly
		? ''
		: 'cursor-pointer hover:bg-slate-50/80'} {row.expiryState === 'expired' ? 'bg-red-50/40' : ''}"
	onclick={() => {
		if (!readonly) onopen(row);
	}}
>
	<!-- รายการ (+ category, location below xl, status badges below lg) -->
	<Table.Cell class="px-3 py-3.5 lg:px-4">
		<button
			type="button"
			disabled={readonly}
			class="rounded text-left text-base font-semibold text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-default"
		>
			{row.name}
		</button>
		<p class="mt-0.5 text-xs text-slate-500">
			{row.categoryLabel}{#if row.locationLabel}<span class="xl:hidden">
					· {row.locationLabel}</span
				>{/if}
		</p>
		<StatusBadges {badges} class="mt-1.5 lg:hidden" />
	</Table.Cell>

	<!-- คงเหลือ / เกณฑ์ -->
	<Table.Cell class="w-48 px-3 py-3.5 lg:px-4 xl:w-64">
		<p class="flex items-baseline gap-1.5">
			<span class="text-base font-bold text-slate-900 tabular-nums xl:text-lg">{row.qtyOnHand}</span
			>
			<span class="text-xs text-slate-500">{row.unitLabel}</span>
		</p>
		<div class="mt-1.5">
			<StockBar onHand={row.qtyOnHand} threshold={row.reorderThreshold} {caption} />
		</div>
	</Table.Cell>

	<!-- หมดอายุเร็วสุด -->
	<Table.Cell class="w-32 px-3 py-3.5 lg:px-4 xl:w-40">
		<p class="text-sm font-semibold tabular-nums {EXPIRY_CLASS[expiry.tone]}">{expiry.text}</p>
		{#if expiry.relative}
			<p class="text-xs {EXPIRY_CLASS[expiry.tone]}">{expiry.relative}</p>
		{/if}
		{#if row.lotCount > 0}
			<p class="mt-0.5 text-xs text-slate-500 tabular-nums">{row.lotCount} ล็อต</p>
		{/if}
	</Table.Cell>

	<!-- ที่เก็บ (xl+) -->
	<Table.Cell class="hidden px-4 py-3.5 text-sm text-slate-700 xl:table-cell">
		{#if row.locationLabel}{row.locationLabel}{:else}<span class="text-slate-400">—</span>{/if}
	</Table.Cell>

	<!-- สถานะ (lg+) -->
	<Table.Cell class="hidden px-4 py-3.5 lg:table-cell">
		<StatusBadges {badges} class="flex-col items-start" />
	</Table.Cell>

	<!-- จัดการ -->
	<Table.Cell class="w-32 px-3 py-2.5 lg:px-4 xl:w-48">
		<RowActions
			itemName={row.name}
			layout="inline"
			disabled={readonly || offline}
			distributeDisabled={!canDistribute}
			onreceive={() => onreceive(row)}
			ondistribute={() => ondistribute(row)}
		/>
	</Table.Cell>
</Table.Row>
