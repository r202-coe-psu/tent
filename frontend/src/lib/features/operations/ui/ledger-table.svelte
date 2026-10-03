<script lang="ts">
	import ItemHistory from './ledger/item-history.svelte';
	import LedgerMovements from './ledger/ledger-movements.svelte';

	/** With an item id: that item's compact history. Without: the shelter-wide movements view. */
	let { filterItemId = undefined }: { filterItemId?: string } = $props();
</script>

{#if filterItemId}
	<ItemHistory {filterItemId} />
{:else}
	<LedgerMovements />
{/if}
