<script lang="ts">
	import type { IconProps } from '@lucide/svelte';

	// Lucide has no fork-and-spoon icon: its `utensils` fork with the knife swapped for a spoon.
	// Drawn inline because the runtime `Icon` lives only in the whole-package entry (lint-banned).
	let {
		size = 24,
		color = 'currentColor',
		strokeWidth = 2,
		class: className,
		...rest
	}: IconProps = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke={color}
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={['lucide-icon lucide lucide-fork-spoon', className]}
	{...rest}
>
	<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
	<path d="M7 2v20" />
	<ellipse cx="17" cy="6.5" rx="3.5" ry="4.5" />
	<path d="M17 11v11" />
</svg>
