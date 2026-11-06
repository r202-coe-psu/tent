<script lang="ts">
	import { stockBarSegments, type StockBarTone } from './stock-bar';

	let {
		onHand,
		threshold,
		caption,
		incoming = null
	}: {
		onHand: string;
		threshold: string | null;
		/** Visible line under the bar, e.g. "เกณฑ์ 40 กล่อง · พอ ~1 วัน". */
		caption: string;
		/** Incoming qty (#1153): drawn after the in-stock segment; status colour stays in-stock only. */
		incoming?: string | null;
	} = $props();

	const fill = $derived(stockBarSegments(onHand, incoming ?? '0', threshold));

	const TONE_CLASS: Record<StockBarTone, string> = {
		critical: 'bg-red-600',
		warning: 'bg-amber-600',
		ok: 'bg-emerald-600',
		neutral: 'bg-slate-400'
	};
	const STRIPES =
		'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.55) 0 2px, transparent 2px 5px)';
</script>

<div class="min-w-0">
	<div
		class="relative h-1.5 rounded-full bg-slate-200"
		role="img"
		aria-label="ในคลัง {onHand}{incoming ? ` กำลังมา ${incoming}` : ''} {threshold === null
			? 'ไม่มีเกณฑ์สั่งเพิ่ม'
			: `เกณฑ์สั่งเพิ่ม ${threshold}`}"
	>
		<div
			class="absolute inset-y-0 left-0 rounded-full {TONE_CLASS[fill.tone]}"
			style:width="{fill.pct}%"
		></div>
		{#if fill.incomingPct > 0}
			<div
				class="absolute inset-y-0 bg-sky-500 {fill.pct > 0 ? 'rounded-r-full' : 'rounded-full'}"
				style:left="{fill.pct}%"
				style:width="{fill.incomingPct}%"
				style:background-image={STRIPES}
			></div>
		{/if}
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
