<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/shadcn.js';
	import { spatial } from '$lib/tokens';

	let {
		class: className = '',
		nav,
		children
	}: {
		class?: string;
		nav: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class={cn(spatial.container.staffPageCard, className)}>
	<div class="flex flex-col lg:flex-row">
		{@render nav()}
		<div class="min-w-0 flex-1">
			{@render children()}
		</div>
	</div>
</div>
