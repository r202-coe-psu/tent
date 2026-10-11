<script lang="ts">
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
	const expiryLine = $derived(
		expiry.text === '—'
			? null
			: [`หมดอายุ ${expiry.text}`, expiry.relative].filter(Boolean).join(' · ')
	);

	const EXPIRY_CLASS = {
		critical: 'text-red-700',
		warning: 'text-amber-700',
		muted: 'text-slate-500',
		default: 'text-slate-500'
	};
</script>

<div
	class="flex items-center gap-2.5 rounded-xl border bg-white p-3 pl-3.5 shadow-2xs {row.expiryState ===
	'expired'
		? 'border-red-200'
		: 'border-slate-200/80'}"
>
	<button
		type="button"
		disabled={readonly}
		onclick={() => onopen(row)}
		class="min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-default"
	>
		<span class="block text-base font-semibold text-slate-900">{row.name}</span>
		<span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="flex items-baseline gap-1.5">
				<span class="text-xl font-bold text-slate-900 tabular-nums">{row.qtyOnHand}</span>
				<span class="text-sm text-slate-500">{row.unitLabel}</span>
			</span>
			<StatusBadges {badges} />
		</span>
		<span class="mt-2 block">
			<StockBar onHand={row.qtyOnHand} threshold={row.reorderThreshold} {caption} />
		</span>
		{#if expiryLine}
			<span class="mt-1 block text-xs font-medium tabular-nums {EXPIRY_CLASS[expiry.tone]}">
				{expiryLine}
			</span>
		{/if}
	</button>
	<RowActions
		itemName={row.name}
		layout="stack"
		disabled={readonly || offline}
		distributeDisabled={!canDistribute}
		onreceive={() => onreceive(row)}
		ondistribute={() => ondistribute(row)}
	/>
</div>
