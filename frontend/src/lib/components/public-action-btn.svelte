<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes, HTMLAnchorAttributes } from 'svelte/elements';

	let {
		variant = 'solid',
		disabled = false,
		href,
		children,
		...rest
	}: {
		variant?: 'solid' | 'outline';
		disabled?: boolean;
		href?: string;
		children: Snippet;
	} & HTMLButtonAttributes &
		HTMLAnchorAttributes = $props();

	const baseClasses =
		'flex w-full items-center justify-center rounded-xl px-3 py-3 font-bold transition-colors shadow-sm';

	const variants = {
		solid: 'bg-primary text-white hover:bg-primary-dark text-xs',
		outline: 'bg-transparent border border-primary/20 text-[11px] text-primary hover:bg-slate-50'
	};

	const disabledClasses = 'opacity-50 cursor-not-allowed pointer-events-none grayscale';
</script>

{#if href && !disabled}
	<a {href} class="{baseClasses} {variants[variant]}" {...rest}>
		{@render children()}
	</a>
{:else}
	<button
		{disabled}
		class="{baseClasses} {variants[variant]} {disabled ? disabledClasses : ''}"
		{...rest}
	>
		{@render children()}
	</button>
{/if}
