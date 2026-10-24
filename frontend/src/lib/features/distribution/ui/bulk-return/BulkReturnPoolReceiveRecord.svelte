<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { receiveRecordRows, receivedStorageLabel } from '../model/bulk-return-lifecycle';
	import type { BulkReturnPoolRow, PoolCatalogItem } from '../model/bulk-return-pool-v3';

	/** Read-only receive record of a RECEIVED pool (visible to every viewer of the detail). */
	interface Props {
		row: BulkReturnPoolRow;
		catalog: readonly PoolCatalogItem[];
	}

	let { row, catalog }: Props = $props();

	const pool = $derived(row.pool);
	const rows = $derived(receiveRecordRows(pool, catalog));
	const receivedAt = $derived(pool.received_at ? formatThaiDateTime(pool.received_at) : '—');
</script>

<section aria-labelledby="pool-receive-record-heading" class="space-y-2">
	<h3 id="pool-receive-record-heading" class="text-base font-semibold text-slate-800">
		ผลการตรวจรับ
	</h3>
	<dl class="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
		<dt class="text-slate-500">ตรวจรับเมื่อ</dt>
		<dd class="text-slate-900">
			<span class="tabular-nums">{receivedAt}</span>
			{#if pool.received_by}
				<span class="text-slate-500">· {pool.received_by}</span>
			{/if}
		</dd>
		<dt class="flex items-center gap-1.5 text-slate-500">
			<MapPin class="h-4 w-4" aria-hidden="true" />จุดเก็บของที่รับเข้า
		</dt>
		<dd class="font-medium text-slate-900">{receivedStorageLabel(pool)}</dd>
	</dl>

	{#if rows.length === 0}
		<p class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
			ไม่มีข้อมูลผลการตรวจรับ
		</p>
	{:else}
		<ul class="space-y-2">
			{#each rows as record (record.item_id)}
				<li
					class="space-y-1.5 rounded-xl border p-3 text-sm shadow-2xs {record.mismatched
						? 'border-amber-200 bg-amber-50/40'
						: 'border-slate-200/80 bg-white'}"
				>
					<p class="font-semibold break-words text-slate-900">{record.name}</p>
					<dl class="grid grid-cols-3 gap-2 text-xs text-slate-500">
						<div>
							<dt>ส่งมา</dt>
							<dd class="text-sm font-semibold text-slate-900 tabular-nums">
								{record.expected}
								{record.unit}
							</dd>
						</div>
						<div>
							<dt>รับจริง</dt>
							<dd class="text-sm font-semibold text-slate-900 tabular-nums">
								{record.received}
								{record.unit}
							</dd>
						</div>
						<div>
							<dt>ส่วนต่าง</dt>
							<dd
								class="text-sm font-semibold tabular-nums {record.mismatched
									? 'text-amber-900'
									: 'text-slate-900'}"
							>
								{record.diff === 0 ? '—' : `−${record.diff} ${record.unit}`}
							</dd>
						</div>
					</dl>
					{#if record.reasonLabel}
						<p class="text-xs break-words text-amber-900">
							เหตุผล: <span class="font-medium">{record.reasonLabel}</span>
							{#if record.note}
								· {record.note}
							{/if}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
