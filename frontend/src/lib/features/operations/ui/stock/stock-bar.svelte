<script lang="ts">
	import { stockBarFill, type StockBarTone } from './stock-bar';

	let {
		onHand,
		threshold,
		caption
	}: {
		onHand: string;
		threshold: string | null;
		/** Visible line under the bar, e.g. "เกณฑ์ 40 กล่อง · พอ ~1 วัน". */
		caption: string;
	} = $props();

	const fill = $derived(stockBarFill(onHand, threshold));

	const TONE_CLASS: Record<StockBarTone, string> = {
		critical: 'bg-red-600',
		warning: 'bg-amber-600',
		ok: 'bg-emerald-600',
		neutral: 'bg-slate-400'
	};
</script>

<div class="min-w-0">
	<div
		class="relative h-1.5 rounded-full bg-slate-200"
		role="img"
		aria-label="คงเหลือ {onHand} {threshold === null
			? 'ไม่มีเกณฑ์สั่งเพิ่ม'
			: `เกณฑ์สั่งเพิ่ม ${threshold}`}"
	>
		<div
			class="absolute inset-y-0 left-0 rounded-full {TONE_CLASS[fill.tone]}"
			style:width="{fill.pct}%"
		></div>
		{#if fill.tickPct !== null}
			<div
				class="absolute -top-0.5 h-2.5 w-0.5 bg-slate-700"
				style:left="{fill.tickPct}%"
				aria-hidden="true"
			></div>
		{/if}
	</div>
	<p class="mt-1.5 text-xs text-slate-500">{caption}</p>
</div>
