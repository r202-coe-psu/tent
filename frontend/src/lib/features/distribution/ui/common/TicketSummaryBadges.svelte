<script lang="ts">
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Package from '@lucide/svelte/icons/package';
	import Clock from '@lucide/svelte/icons/clock';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { ticketCardSummary } from '../model/distribution-point';

	/** Type · meal (food only) · service day badges shared by the desk's ticket cards (#1183). */
	let { ticket }: { ticket: RequisitionTicket } = $props();

	const summary = $derived(ticketCardSummary(ticket));
	const isFood = $derived(ticket.requisition_type === 'food');
	const neutral =
		'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700';
</script>

<span class={isFood ? 'badge-domain-kitchen' : 'badge-domain-donation'}>
	{#if isFood}
		<UtensilsCrossed class="size-3.5" aria-hidden="true" />
	{:else}
		<Package class="size-3.5" aria-hidden="true" />
	{/if}
	{summary.type}
</span>
{#if summary.meal}
	<span class={neutral}>
		<Clock class="size-3.5" aria-hidden="true" />
		{summary.meal}
	</span>
{/if}
<span class={neutral}>
	<CalendarDays class="size-3.5" aria-hidden="true" />
	{summary.day}
</span>
