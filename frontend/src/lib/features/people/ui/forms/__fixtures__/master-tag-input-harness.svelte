<script lang="ts">
	import type { MasterDataItem } from '$lib/features/master-data';
	import MasterTagInput from '../master-tag-input.svelte';

	/** Test-only parent: owns the bound `value` and echoes what would be stored. */
	let {
		initial,
		items
	}: {
		initial: string[];
		items: readonly MasterDataItem[];
	} = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(initial);
</script>

<MasterTagInput id="tags" bind:value {items} listLabel="โรคประจำตัวที่เลือก" />
<output data-testid="value">{JSON.stringify(value)}</output>
