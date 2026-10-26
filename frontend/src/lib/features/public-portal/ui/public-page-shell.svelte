<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		class: className = '',
		maxWidth = 'max-w-7xl',
		children
	}: {
		class?: string;
		maxWidth?: string;
		children: Snippet;
	} = $props();
</script>

<!-- Civic Light Page Container: max-w-7xl + responsive padding -->
<div class={['mx-auto w-full px-4 py-8 sm:px-6 lg:px-8', maxWidth, className]}>
	{@render children()}
</div>
