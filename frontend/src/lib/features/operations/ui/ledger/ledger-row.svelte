<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import GroupTag from './group-tag.svelte';
	import { qtyGt } from '$lib/utils/qty';
	import type { LedgerRow } from './ledger-view';

	let { row }: { row: LedgerRow } = $props();

	const incoming = $derived(qtyGt(row.qty, 0));
</script>

<Table.Row class="border-t border-slate-100 hover:bg-slate-50/60">
	<Table.Cell class="px-4 py-3 text-slate-600 tabular-nums">{row.time}</Table.Cell>
	<Table.Cell class="px-4 py-3"><GroupTag group={row.group} label={row.reasonLabel} /></Table.Cell>
	<Table.Cell class="px-4 py-3 font-semibold text-slate-900">{row.itemName}</Table.Cell>
	<Table.Cell
		class="px-4 py-3 text-right font-bold whitespace-nowrap tabular-nums {incoming
			? 'text-emerald-800'
			: 'text-rose-800'}"
	>
		{incoming ? '+' : ''}{row.qty}
		<span class="font-medium text-slate-500">{row.unit}</span>
	</Table.Cell>
	<Table.Cell class="max-w-64 px-4 py-3 break-words whitespace-normal text-slate-800">
		{row.detail || '—'}
	</Table.Cell>
	<Table.Cell class="px-4 py-3 text-slate-600">
		{[row.lotNo, row.storage].filter(Boolean).join(' · ') || '—'}
	</Table.Cell>
	<Table.Cell class="px-4 py-3 text-slate-600">{row.createdBy}</Table.Cell>
</Table.Row>
