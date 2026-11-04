<script lang="ts">
	import type { FrontlineRecipientSelection } from '../model/frontline-handover';
	import type { AddEntriesSummary } from '../model/bulk-return-add-entry';
	import AddBulkReturnEntriesForm from './AddBulkReturnEntriesForm.svelte';

	/**
	 * "รับของเข้ากอง" dialog (#659). The form is mounted only while `open`, so each open starts from
	 * the initial props with fresh line ULIDs. Callers should show the entry point only when
	 * canWriteBulkReturnEntry; the pool list is read inside (shared TanStack cache with the board).
	 */
	interface Props {
		open: boolean;
		shelterCode?: string;
		initialPoolId?: string;
		initialReturner?: FrontlineRecipientSelection | null;
		initialItemId?: string;
		onsuccess?: (summary: AddEntriesSummary) => void;
	}

	let {
		open = $bindable(false),
		shelterCode,
		initialPoolId,
		initialReturner = null,
		initialItemId,
		onsuccess
	}: Props = $props();
</script>

{#if open}
	<AddBulkReturnEntriesForm
		bind:open
		{shelterCode}
		{initialPoolId}
		{initialReturner}
		{initialItemId}
		{onsuccess}
	/>
{/if}
