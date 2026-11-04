<script lang="ts">
	import { WHOLE_DIGITS_ONLY_MESSAGE } from '../domain/unit-quantity';
	import type { WholeNumberGuard } from './whole-number-input.svelte';

	let {
		guard,
		key = '',
		class: className = ''
	}: { guard: WholeNumberGuard; key?: string; class?: string } = $props();
</script>

{#if guard.isRefused(key)}
	<p role="status" class="text-xs font-semibold text-amber-700 {className}">
		{WHOLE_DIGITS_ONLY_MESSAGE}
	</p>
{/if}
