<script lang="ts">
	import GroupTag from './group-tag.svelte';
	import { qtyGt } from '$lib/utils/qty';
	import type { LedgerRow } from './ledger-view';

	let { row }: { row: LedgerRow } = $props();

	const incoming = $derived(qtyGt(row.qty, 0));
	const place = $derived([row.lotNo, row.storage].filter(Boolean).join(' · '));
</script>

<li class="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-base font-semibold text-slate-900">{row.itemName}</p>
			<p class="mt-1 flex items-center gap-2 text-xs text-slate-600">
				<span class="tabular-nums">{row.time}</span>
				<GroupTag group={row.group} label={row.reasonLabel} />
			</p>
		</div>
		<p
			class="shrink-0 text-lg font-bold whitespace-nowrap tabular-nums {incoming
				? 'text-emerald-800'
				: 'text-rose-800'}"
		>
			{incoming ? '+' : ''}{row.qty}
			<span class="text-sm font-medium text-slate-500">{row.unit}</span>
		</p>
	</div>
	{#if row.detail || place || row.createdBy}
		<dl class="mt-2 space-y-0.5 text-xs text-slate-600">
			{#if row.detail}
				<div class="flex gap-1.5">
					<dt class="shrink-0 text-slate-500">ที่มา/ปลายทาง</dt>
					<dd class="break-words">{row.detail}</dd>
				</div>
			{/if}
			{#if place}
				<div class="flex gap-1.5">
					<dt class="shrink-0 text-slate-500">ล็อต · จุดเก็บ</dt>
					<dd>{place}</dd>
				</div>
			{/if}
			<div class="flex gap-1.5">
				<dt class="shrink-0 text-slate-500">ผู้บันทึก</dt>
				<dd>{row.createdBy}</dd>
			</div>
		</dl>
	{/if}
</li>
