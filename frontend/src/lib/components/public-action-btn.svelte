<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes, HTMLAnchorAttributes } from 'svelte/elements';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

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
		'group/btn flex w-full items-center justify-between gap-2 rounded-xl text-left font-bold transition-all';

	const variants = {
		solid: 'bg-primary text-white hover:bg-primary-dark text-xs p-3 shadow-sm',
		outline: 'bg-transparent text-primary hover:underline text-xs p-2'
	};

	const disabledClasses = 'opacity-50 cursor-not-allowed pointer-events-none grayscale';
</script>

{#if href && !disabled}
	<a {href} class="{baseClasses} {variants[variant]}" {...rest}>
		{@render children()}
		<ChevronRight
			class="h-3.5 w-3.5 shrink-0 transition-transform group-hover/btn:translate-x-1 {variant ===
			'solid'
				? 'text-white/60'
				: 'text-primary/70'}"
		/>
	</a>
{:else}
	<button
		{disabled}
		class="{baseClasses} {variants[variant]} {disabled ? disabledClasses : ''}"
		{...rest}
	>
		{@render children()}
		<ChevronRight
			class="h-3.5 w-3.5 shrink-0 transition-transform group-hover/btn:translate-x-1 {variant ===
			'solid'
				? 'text-white/60'
				: 'text-primary/70'}"
		/>
	</button>
{/if}
