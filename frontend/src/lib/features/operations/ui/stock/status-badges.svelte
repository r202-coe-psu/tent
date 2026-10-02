<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import type { StockBadge, StockBadgeTone } from './stock-view';

	let { badges, class: className = '' }: { badges: StockBadge[]; class?: string } = $props();

	const TONE_CLASS: Record<StockBadgeTone, string> = {
		critical: 'border-red-200 bg-red-50 text-red-900',
		warning: 'border-amber-200 bg-amber-50 text-amber-900',
		ok: 'border-emerald-200 bg-emerald-50 text-emerald-900'
	};
</script>

<span class="flex flex-wrap items-center gap-1.5 {className}">
	{#each badges as badge (badge.label)}
		<span
			class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold {TONE_CLASS[
				badge.tone
			]}"
		>
			{#if badge.tone === 'critical'}
				<CircleAlert class="h-3.5 w-3.5" aria-hidden="true" />
			{:else if badge.tone === 'warning'}
				<TriangleAlert class="h-3.5 w-3.5" aria-hidden="true" />
			{:else}
				<CircleCheck class="h-3.5 w-3.5" aria-hidden="true" />
			{/if}
			{badge.label}
		</span>
	{/each}
</span>
