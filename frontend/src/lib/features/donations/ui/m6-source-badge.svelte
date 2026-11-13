<script lang="ts">
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import { m6SourceLabel, type M6Carrier } from '../domain/m6';

	/**
	 * Where a central-warehouse (M6) donation comes from — shown in place of the donor line, since
	 * an m6 donation has no donor. The request code is what staff match against the delivery note.
	 */
	let {
		row,
		showCode = true,
		class: className = ''
	}: {
		row: M6Carrier;
		showCode?: boolean;
		class?: string;
	} = $props();
</script>

<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 {className}">
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
	>
		<Warehouse class="size-3.5 shrink-0 text-sky-700" aria-hidden="true" />
		{m6SourceLabel(row)}
	</span>
	{#if showCode && row.m6?.request_code}
		<span class="text-xs font-semibold text-slate-500 tabular-nums">
			<span class="sr-only">รหัสคำขอเบิก</span>
			{row.m6.request_code}
		</span>
	{/if}
</span>
