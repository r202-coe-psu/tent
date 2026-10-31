<script lang="ts">
	import type { CountInputGuard } from './count-input-guard.svelte';

	/**
	 * Inline notes under a guarded count box: the guard's note for a refused edit
	 * (`{id}-blocked`) and the field's own validation error (`{id}-error`).
	 */
	let { guard, id, message }: { guard: CountInputGuard; id: string; message: string | null } =
		$props();
</script>

{#if guard.messages[id]}
	<p id="{id}-blocked" role="alert" class="mt-1 text-xs text-destructive">{guard.messages[id]}</p>
{/if}
{#if message}
	<p id="{id}-error" role="alert" class="mt-1 text-xs text-destructive">{message}</p>
{/if}
