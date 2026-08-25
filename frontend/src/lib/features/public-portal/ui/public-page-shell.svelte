<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		class: className = '',
		maxWidth = 'max-w-380',
		children
	}: {
		class?: string;
		/** Content width cap. Defaults to the /shelters width; the donation
		 * wizard passes `max-w-5xl` to match the v8.5 design. */
		maxWidth?: string;
		children: Snippet;
	} = $props();
</script>

<!-- Matches /shelters: max-w-380 + horizontal padding -->
<div class={['mx-auto w-full px-4 py-8 sm:px-6', maxWidth, className]}>
	{@render children()}
</div>
