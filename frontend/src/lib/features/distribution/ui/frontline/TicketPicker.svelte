<script lang="ts">
	import type { Snippet } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import SearchIcon from '@lucide/svelte/icons/search';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { ticketOptionLabel } from '../model/distribution-point';
	import { searchTickets } from '../model/ticket-picker';
	import TicketOptionText from './TicketOptionText.svelte';

	interface Props {
		id: string;
		label: string;
		tickets: readonly RequisitionTicket[];
		selectedId: string;
		onPick: (ticketId: string) => void;
		/** Extra badges per ticket, e.g. its status on the close-out tab. */
		badges?: Snippet<[RequisitionTicket]>;
	}

	let { id, label, tickets, selectedId, onPick, badges }: Props = $props();

	let open = $state(false);
	let query = $state('');

	const selected = $derived(tickets.find((t) => t._id === selectedId) ?? null);
	const matches = $derived(searchTickets(tickets, query, (t) => ticketOptionLabel(t)));

	function pick(ticketId: string) {
		onPick(ticketId);
		// Closing through `open` does not fire onOpenChange, so clear the search here too.
		open = false;
		query = '';
	}
</script>

<div class="space-y-2">
	<p id={`${id}-label`} class="text-sm font-semibold text-slate-700">
		{label}
		<span class="font-normal text-slate-500">({tickets.length} ใบ)</span>
	</p>

	<Popover.Root bind:open onOpenChange={(next) => !next && (query = '')}>
		<Popover.Trigger
			{id}
			aria-labelledby={`${id}-label ${id}`}
			class="flex h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-900 shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			{#if selected}
				<span class="flex min-w-0 flex-1 items-center gap-2">
					{@render badges?.(selected)}
					<TicketOptionText ticket={selected} variant="trigger" />
				</span>
			{:else}
				<span class="flex-1 truncate text-slate-500">เลือกตั๋ว</span>
			{/if}
			<ChevronDown class="size-4 shrink-0 text-slate-500" aria-hidden="true" />
		</Popover.Trigger>

		<Popover.Content
			align="start"
			class="w-(--bits-floating-anchor-width) max-w-[calc(100vw-2rem)] min-w-72 p-2"
		>
			<div class="relative">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500"
					aria-hidden="true"
				/>
				<Input
					type="search"
					bind:value={query}
					placeholder="ค้นหา มื้อ วัน จุดแจก หรือเลขตั๋ว"
					aria-label={`ค้นหา${label}`}
					class="h-11 pl-9 text-base"
					onkeydown={(e) => {
						if (e.key === 'Enter' && matches[0]) {
							e.preventDefault();
							pick(matches[0]._id);
						}
					}}
				/>
			</div>

			<ul class="mt-2 max-h-80 space-y-1 overflow-y-auto" aria-label={label}>
				{#each matches as ticket (ticket._id)}
					{@const isSelected = ticket._id === selectedId}
					<li>
						<button
							type="button"
							aria-pressed={isSelected}
							onclick={() => pick(ticket._id)}
							class="flex min-h-12 w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none {isSelected
								? 'bg-sky-50'
								: 'hover:bg-slate-50'}"
						>
							<span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
								{#if isSelected}
									<CheckIcon class="size-4 text-sky-600" aria-hidden="true" />
								{/if}
							</span>
							<TicketOptionText {ticket}>
								{#snippet trailing()}
									{@render badges?.(ticket)}
								{/snippet}
							</TicketOptionText>
						</button>
					</li>
				{:else}
					<li class="py-6 text-center text-sm text-slate-500">ไม่พบตั๋วที่ตรงกับคำค้น</li>
				{/each}
			</ul>
		</Popover.Content>
	</Popover.Root>
</div>
