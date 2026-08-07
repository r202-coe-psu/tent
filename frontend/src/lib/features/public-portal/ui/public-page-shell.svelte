<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		class: className = '',
		children
	}: {
		class?: string;
		children: Snippet;
	} = $props();
</script>

<!-- Matches /public/shelters: max-w-380 + horizontal padding -->
<div class={['mx-auto w-full max-w-380 px-4 py-8 sm:px-6', className]}>
	{@render children()}
</div>
