<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ticketOption } from '../model/distribution-point';

	interface Props {
		ticket: Parameters<typeof ticketOption>[0];
		/** `trigger`: one truncated line for a closed select; `item`: title plus labelled details. */
		variant?: 'trigger' | 'item';
		/** Badges shown at the end of the title line (item variant). */
		trailing?: Snippet;
	}

	let { ticket, variant = 'item', trailing }: Props = $props();

	const option = $derived(ticketOption(ticket));
</script>

{#if variant === 'trigger'}
	<span class="min-w-0 truncate">
		<span class="font-semibold text-slate-900">{option.title}</span>
		{#if option.details[0]}
			<span class="ml-2 text-slate-500">{option.details[0].label} {option.details[0].value}</span>
		{/if}
		<span class="sr-only">เลขตั๋ว {ticket.ticket_no}</span>
	</span>
{:else}
	<span class="flex w-full min-w-0 flex-col gap-0.5 text-left">
		<span class="flex items-center justify-between gap-2">
			<span class="min-w-0 truncate font-semibold text-slate-900">{option.title}</span>
			{@render trailing?.()}
		</span>
		<span class="flex min-w-0 flex-wrap gap-x-3 text-xs text-slate-700">
			{#each option.details as detail (detail.label)}
				<span class="min-w-0 truncate">
					<span class="text-slate-500">{detail.label}</span>
					{detail.value}
				</span>
			{/each}
		</span>
	</span>
{/if}
