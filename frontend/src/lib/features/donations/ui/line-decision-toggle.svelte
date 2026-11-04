<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Keep or turn away one line — the same two halves on the review screen and at the
	 * counter, so staff learn it once. Pressing the chosen half again clears it.
	 * Colour is never the only signal: each half carries an icon and its own words.
	 */
	let {
		value = $bindable(null),
		acceptLabel,
		acceptHint,
		rejectLabel = 'ไม่รับรายการนี้',
		rejectHint = 'แจ้งเหตุผลให้ผู้บริจาค',
		groupLabel,
		disabled = false
	}: {
		value?: 'accept' | 'reject' | null;
		acceptLabel: string;
		acceptHint?: string;
		rejectLabel?: string;
		rejectHint?: string;
		/** Names the item the pair decides, for screen readers. */
		groupLabel: string;
		disabled?: boolean;
	} = $props();

	function choose(next: 'accept' | 'reject') {
		value = value === next ? null : next;
	}
</script>

<div class="grid grid-cols-2 gap-3" role="group" aria-label={groupLabel}>
	<Button
		type="button"
		variant="outline"
		aria-pressed={value === 'accept'}
		{disabled}
		onclick={() => choose('accept')}
		class="h-auto min-h-14 w-full flex-col gap-0.5 rounded-xl border-2 px-3 py-2.5 whitespace-normal {value ===
		'accept'
			? 'border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-50'
			: 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50'}"
	>
		<span class="flex items-center gap-2 text-base font-bold">
			<CircleCheck
				class="size-5 shrink-0 {value === 'accept' ? 'text-emerald-600' : 'text-slate-400'}"
				aria-hidden="true"
			/>
			{acceptLabel}
		</span>
		{#if acceptHint}
			<span class="text-xs font-normal text-slate-500">{acceptHint}</span>
		{/if}
	</Button>
	<Button
		type="button"
		variant="outline"
		aria-pressed={value === 'reject'}
		{disabled}
		onclick={() => choose('reject')}
		class="h-auto min-h-14 w-full flex-col gap-0.5 rounded-xl border-2 px-3 py-2.5 whitespace-normal {value ===
		'reject'
			? 'border-red-500 bg-red-50 text-red-900 hover:bg-red-50'
			: 'border-slate-200 bg-white text-slate-700 hover:border-red-300 hover:bg-red-50/50'}"
	>
		<span class="flex items-center gap-2 text-base font-bold">
			<CircleX
				class="size-5 shrink-0 {value === 'reject' ? 'text-red-600' : 'text-slate-400'}"
				aria-hidden="true"
			/>
			{rejectLabel}
		</span>
		{#if rejectHint}
			<span class="text-xs font-normal text-slate-500">{rejectHint}</span>
		{/if}
	</Button>
</div>
