<script lang="ts">
	import Loader from '@lucide/svelte/icons/loader';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Truck from '@lucide/svelte/icons/truck';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { Button } from '$lib/components/ui/button/index.js';
	import TicketSummaryBadges from '../common/TicketSummaryBadges.svelte';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { ticketCardSummary, ticketItemLines } from '../model/distribution-point';

	interface Props {
		ticket: RequisitionTicket;
		/** Unit label of an item's base unit; '' while the catalog is loading. */
		unitOf: (itemId: string) => string;
		receiving: boolean;
		canReceive: boolean;
		onReceive: (ticket: RequisitionTicket) => void;
	}

	let { ticket, unitOf, receiving, canReceive, onReceive }: Props = $props();

	const summary = $derived(ticketCardSummary(ticket));
	const lines = $derived(ticketItemLines(ticket.items, unitOf));
</script>

<article
	class="grid grid-cols-1 gap-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 lg:grid-cols-12 lg:gap-6"
	aria-label={`ตั๋ว${summary.type} ส่งไปที่ ${summary.destination}`}
>
	<!-- What and where: left on wide screens, top on phones/tablets -->
	<div class="flex min-w-0 flex-col gap-4 lg:col-span-5">
		<div class="flex flex-wrap items-center gap-2">
			<TicketSummaryBadges {ticket} />
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
			>
				<Truck class="size-3.5" aria-hidden="true" />
				กำลังนำส่ง
			</span>
		</div>

		<div>
			<p class="text-xs font-semibold text-slate-500">จุดปลายทาง</p>
			<h3 class="flex items-start gap-1.5 text-lg font-bold break-words text-slate-900">
				<MapPin class="mt-1 size-4 shrink-0 text-slate-500" aria-hidden="true" />
				{summary.destination}
			</h3>
		</div>

		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm lg:mt-auto">
			{#if ticket.driver_name}
				<dt class="text-slate-500">คนขับ</dt>
				<dd class="font-medium text-slate-800">{ticket.driver_name}</dd>
			{/if}
			{#if ticket.license_plate}
				<dt class="text-slate-500">ทะเบียน</dt>
				<dd class="font-medium text-slate-800">{ticket.license_plate}</dd>
			{/if}
			<dt class="text-slate-500">เลขตั๋ว</dt>
			<dd class="text-slate-600 tabular-nums">{ticket.ticket_no}</dd>
		</dl>
	</div>

	<!-- What arrived and the action: right on wide screens -->
	<div class="flex min-w-0 flex-col gap-3 lg:col-span-7">
		<div class="flex-1">
			<p class="mb-1.5 text-xs font-semibold text-slate-500">รายการที่ส่งมา ({lines.length})</p>
			<ul class="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-slate-50/60">
				{#each lines as line (line.itemId)}
					<li class="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm sm:text-base">
						<span class="min-w-0 break-words text-slate-800">{line.name}</span>
						<span class="shrink-0 font-semibold text-slate-900 tabular-nums">
							{line.qty}
							{line.unit}
						</span>
					</li>
				{/each}
			</ul>
		</div>

		<Button
			type="button"
			onclick={() => onReceive(ticket)}
			disabled={receiving || !canReceive}
			class="h-12 w-full rounded-lg bg-emerald-600 px-5 text-base font-bold text-white hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:ml-auto sm:w-auto lg:w-full"
		>
			{#if receiving}
				<Loader class="size-4 animate-spin" aria-hidden="true" />
				<span>กำลังตรวจรับ...</span>
			{:else}
				<CheckCircle2 class="size-4" aria-hidden="true" />
				<span>ตรวจรับเข้าจุดแจก</span>
			{/if}
		</Button>
	</div>
</article>
