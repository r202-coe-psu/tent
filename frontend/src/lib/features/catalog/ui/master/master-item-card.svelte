<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import MasterBadge from './master-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ORIGIN_LABELS, ORIGIN_TONES, type MasterItemRow } from './master-view';

	let {
		row,
		onopen,
		onfill
	}: {
		row: MasterItemRow;
		onopen: (row: MasterItemRow) => void;
		onfill: (row: MasterItemRow) => void;
	} = $props();
</script>

<div
	class="rounded-xl border border-slate-200/80 bg-white shadow-2xs {row.item.deactivated
		? 'opacity-70'
		: ''}"
>
	<button
		type="button"
		onclick={() => onopen(row)}
		class="flex min-h-11 w-full items-center gap-2.5 rounded-xl p-3.5 text-left focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
	>
		<span class="min-w-0 flex-1">
			<span class="flex flex-wrap items-center gap-2">
				<span class="text-base font-semibold text-slate-900">{row.item.name}</span>
				{#if row.isNew}
					<MasterBadge tone="sky">ใหม่</MasterBadge>
				{/if}
			</span>
			<span class="mt-0.5 block text-xs text-slate-500">
				{row.item.sku || 'ไม่มี SKU'} · {row.categoryLabel || 'ไม่ระบุหมวด'}
			</span>
			<span class="mt-1.5 block text-sm leading-relaxed whitespace-pre-line text-slate-700">
				{row.unitLines.join('\n')}
			</span>
			{#if row.stock !== null}
				<span class="mt-1.5 block text-sm text-slate-700">
					ในคลังตอนนี้ <strong class="font-bold text-slate-900 tabular-nums">{row.stock}</strong>
				</span>
			{/if}
			{#if row.missing.length > 0}
				<span class="mt-1.5 block text-sm text-amber-900">ยังขาด: {row.missing.join(', ')}</span>
			{/if}
			<span class="mt-2 flex flex-wrap gap-1.5">
				<MasterBadge tone={ORIGIN_TONES[row.origin]}>{ORIGIN_LABELS[row.origin]}</MasterBadge>
				<MasterBadge tone={row.item.deactivated ? 'red' : 'green'}>
					{row.item.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
				</MasterBadge>
			</span>
		</span>
		<ChevronRight class="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
	</button>
	{#if row.canFill}
		<div class="border-t border-slate-100 px-3.5 pt-2.5 pb-3">
			<Button
				type="button"
				variant="outline"
				class="min-h-11 w-full border-[#0A2647] text-sm font-bold text-[#0A2647]"
				onclick={() => onfill(row)}
			>
				เติมข้อมูล
			</Button>
		</div>
	{/if}
</div>
