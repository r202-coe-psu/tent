<script lang="ts">
	import type { Snippet } from 'svelte';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import TicketSummaryBadges from './TicketSummaryBadges.svelte';

	/**
	 * Card header shared by the desk's food, supplies and close-out cards (#1183): what the ticket
	 * is (type · meal · day badges), where it goes, and its number as a reference.
	 */
	let { ticket, badges }: { ticket: RequisitionTicket; badges?: Snippet } = $props();
</script>

<div class="min-w-0 space-y-3">
	<div class="flex flex-wrap items-center gap-2">
		{@render badges?.()}
		<TicketSummaryBadges {ticket} />
	</div>
	<div>
		<p class="text-xs font-semibold text-slate-500">จุดแจก</p>
		<h3 class="flex items-start gap-1.5 text-lg font-bold break-words text-slate-900">
			<MapPin class="mt-1 size-4 shrink-0 text-slate-500" aria-hidden="true" />
			{ticket.destination_location.trim()}
		</h3>
		<p class="mt-0.5 text-sm text-slate-500">
			เลขตั๋ว <span class="tabular-nums">{ticket.ticket_no}</span>
		</p>
	</div>
</div>
