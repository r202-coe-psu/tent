<script lang="ts">
	import { page } from '$app/state';
	import { TicketDetail } from '$lib/features/tickets';

	const ticketId = $derived(decodeURIComponent(page.params.id ?? ''));
</script>

<svelte:head>
	<title>{ticketId} · ตั๋วเบิกวัตถุดิบครัว · SmartShelter</title>
</svelte:head>

<TicketDetail id={ticketId} />
