<script lang="ts">
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { pageRange } from './master-view';

	let {
		page = $bindable(1),
		count,
		perPage,
		unit = 'รายการ'
	}: {
		page?: number;
		count: number;
		perPage: number;
		/** Noun after the count, e.g. "รายการ", "หน่วย", "สูตร". */
		unit?: string;
	} = $props();

	const range = $derived(pageRange(page, count, perPage));
</script>

<div
	class="flex flex-col items-center justify-between gap-3 border-t border-slate-200/80 px-4 py-3 text-sm text-slate-600 sm:flex-row"
>
	<span class="tabular-nums">แสดง {range.start}–{range.end} จาก {count} {unit}</span>
	<PaginationControls bind:page {count} {perPage} />
</div>
