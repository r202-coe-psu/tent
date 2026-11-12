<script lang="ts">
	import CreateTicketDialog from '../CreateTicketDialog.svelte';

	let open = $state(false);

	/** Opens the dialog later, as the ticket page does after it has been sitting open. */
	export function show() {
		open = true;
	}
</script>

<CreateTicketDialog bind:open shelterCode="SH001" onCreated={() => {}} onClose={() => {}} />
