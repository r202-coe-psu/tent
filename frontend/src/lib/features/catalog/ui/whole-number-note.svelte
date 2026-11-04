<script lang="ts">
	import { WHOLE_DIGITS_ONLY_MESSAGE } from '../domain/unit-quantity';
	import type { WholeNumberGuard } from './whole-number-input.svelte';

	let {
		guard,
		key = '',
		message = WHOLE_DIGITS_ONLY_MESSAGE,
		class: className = ''
	}: { guard: WholeNumberGuard; key?: string; message?: string; class?: string } = $props();
</script>

{#if guard.isRefused(key)}
	<p role="status" class="text-xs font-semibold text-amber-700 {className}">
		{message}
	</p>
{/if}
