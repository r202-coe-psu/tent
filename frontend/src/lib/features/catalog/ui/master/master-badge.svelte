<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { MasterBadgeTone } from './master-view';

	let {
		tone = 'slate',
		class: className = '',
		children
	}: { tone?: MasterBadgeTone; class?: string; children: Snippet } = $props();

	const TONE_CLASS: Record<MasterBadgeTone, string> = {
		slate: 'border-slate-200 bg-slate-50 text-slate-800',
		amber: 'border-amber-200 bg-amber-50 text-amber-900',
		sky: 'border-sky-200 bg-sky-50 text-sky-900',
		green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		red: 'border-red-200 bg-red-50 text-red-900',
		blue: 'border-blue-200 bg-blue-50 text-blue-900',
		orange: 'border-orange-200 bg-orange-50 text-orange-900',
		cyan: 'border-cyan-200 bg-cyan-50 text-cyan-900',
		purple: 'border-purple-200 bg-purple-50 text-purple-900'
	};
</script>

<span
	class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap {TONE_CLASS[
		tone
	]} {className}"
>
	{@render children()}
</span>
