<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Table from '$lib/components/ui/table/index.js';
	import MasterBadge from './master-badge.svelte';
	import { ORIGIN_LABELS, ORIGIN_TONES, type MasterItemRow } from './master-view';

	let { row, onopen }: { row: MasterItemRow; onopen: (row: MasterItemRow) => void } = $props();
</script>

<Table.Row
	class="cursor-pointer align-top transition-colors hover:bg-slate-50/80 {row.item.deactivated
		? 'opacity-70'
		: ''}"
	onclick={() => onopen(row)}
>
	<Table.Cell class="px-4 py-3.5">
		<button
			type="button"
			class="rounded text-left text-base font-semibold text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			{row.item.name}
		</button>
		<p class="mt-0.5 text-xs text-slate-500">
			{row.item.sku || 'ไม่มี SKU'} · {row.categoryLabel || 'ไม่ระบุหมวด'}
		</p>
	</Table.Cell>
	<Table.Cell class="px-4 py-3.5 text-sm leading-relaxed whitespace-pre-line text-slate-700">
		{row.unitLines.join('\n')}
	</Table.Cell>
	<Table.Cell class="px-4 py-3.5">
		<MasterBadge tone={ORIGIN_TONES[row.origin]}>{ORIGIN_LABELS[row.origin]}</MasterBadge>
	</Table.Cell>
	<Table.Cell class="px-4 py-3.5">
		<MasterBadge tone={row.item.deactivated ? 'red' : 'green'}>
			{row.item.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
		</MasterBadge>
	</Table.Cell>
	<Table.Cell class="w-10 px-3 py-3.5 text-right">
		<ChevronRight class="inline h-[18px] w-[18px] text-slate-400" aria-hidden="true" />
	</Table.Cell>
</Table.Row>
