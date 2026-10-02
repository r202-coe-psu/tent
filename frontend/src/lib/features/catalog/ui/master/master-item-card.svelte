<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import MasterBadge from './master-badge.svelte';
	import { ORIGIN_LABELS, ORIGIN_TONES, type MasterItemRow } from './master-view';

	let { row, onopen }: { row: MasterItemRow; onopen: (row: MasterItemRow) => void } = $props();
</script>

<button
	type="button"
	onclick={() => onopen(row)}
	class="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white p-3.5 text-left shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {row
		.item.deactivated
		? 'opacity-70'
		: ''}"
>
	<span class="min-w-0 flex-1">
		<span class="block text-base font-semibold text-slate-900">{row.item.name}</span>
		<span class="mt-0.5 block text-xs text-slate-500">
			{row.item.sku || 'ไม่มี SKU'} · {row.categoryLabel || 'ไม่ระบุหมวด'}
		</span>
		<span class="mt-1.5 block text-sm leading-relaxed whitespace-pre-line text-slate-700">
			{row.unitLines.join('\n')}
		</span>
		<span class="mt-2 flex flex-wrap gap-1.5">
			<MasterBadge tone={ORIGIN_TONES[row.origin]}>{ORIGIN_LABELS[row.origin]}</MasterBadge>
			<MasterBadge tone={row.item.deactivated ? 'red' : 'green'}>
				{row.item.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
			</MasterBadge>
		</span>
	</span>
	<ChevronRight class="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
</button>
