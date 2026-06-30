<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'solid',
		children
	}: {
		variant?: 'solid' | 'outline';
		children: Snippet;
	} = $props();

	const baseClasses = 'flex w-full items-center justify-center rounded-xl px-3 py-3 font-bold transition-colors shadow-sm';
	
	const variants = {
		solid: 'bg-primary text-white hover:bg-primary-dark text-xs',
		outline: 'bg-transparent border border-primary/20 text-[11px] text-primary hover:bg-slate-50'
	};
</script>

<button class="{baseClasses} {variants[variant]}">
	{@render children()}
</button>
