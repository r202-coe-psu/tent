<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import TicketStatusBadge from '../common/TicketStatusBadge.svelte';
	import { getRequisitionTypeLabel } from '../model/ticket-status';
	import Eye from '@lucide/svelte/icons/eye';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';

	interface Props {
		tickets: readonly RequisitionTicket[];
		pageSize?: number;
		onViewTicket?: (ticket: RequisitionTicket) => void;
	}

	let { tickets, pageSize = 10, onViewTicket }: Props = $props();

	let currentPage = $state(1);

	const totalItems = $derived(tickets.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalItems / pageSize)));

	// If page exceeds totalPages due to filtering, adjust
	$effect(() => {
		if (currentPage > totalPages) {
			currentPage = 1;
		}
	});

	const paginatedTickets = $derived.by(() => {
		const start = (currentPage - 1) * pageSize;
		return tickets.slice(start, start + pageSize);
	});

	function formatDateTime(isoString: string): string {
		try {
			return new Intl.DateTimeFormat('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			}).format(new Date(isoString));
		} catch {
			return isoString;
		}
	}

	function handleViewDetails(ticket: RequisitionTicket) {
		if (onViewTicket) {
			onViewTicket(ticket);
		} else {
			// Future-compatible URL query param for Slice 5.2 deep-linking
			const url = new URL(window.location.href);
			url.searchParams.set('ticketId', ticket._id);
			window.history.pushState({}, '', url.toString());
		}
	}
</script>

<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	{#if tickets.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center p-12 text-center">
			<div
				class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"
			>
				<Inbox class="h-6 w-6" />
			</div>
			<h3 class="text-sm font-semibold text-slate-900">ไม่พบตั๋วเบิกจ่าย</h3>
			<p class="mt-1 max-w-sm text-xs text-slate-500">
				ไม่มีตั๋วเบิกจ่ายที่ตรงกับเงื่อนไขการค้นหาหรือตัวกรองปัจจุบัน
			</p>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm text-slate-700">
				<thead
					class="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold tracking-wider text-slate-600 uppercase"
				>
					<tr>
						<th scope="col" class="py-3.5 pr-3 pl-4 sm:pl-6">เลขที่ตั๋ว</th>
						<th scope="col" class="px-3 py-3.5">ประเภท</th>
						<th scope="col" class="px-3 py-3.5">จุดหมายปลายทาง</th>
						<th scope="col" class="px-3 py-3.5">ผู้ร้องขอ</th>
						<th scope="col" class="px-3 py-3.5">วันที่สร้าง</th>
						<th scope="col" class="px-3 py-3.5">สถานะ</th>
						<th scope="col" class="relative py-3.5 pr-4 pl-3 text-right sm:pr-6">
							<span class="sr-only">การจัดการ</span>
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each paginatedTickets as ticket (ticket._id)}
						<tr class="transition-colors hover:bg-slate-50/80">
							<td
								class="py-3.5 pr-3 pl-4 text-sm font-bold whitespace-nowrap text-[#0A2647] sm:pl-6"
							>
								<span class="font-mono">{ticket.ticket_no}</span>
								{#if ticket.meal}
									<span
										class="ml-1.5 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700"
									>
										มื้อ{ticket.meal === 'breakfast'
											? 'เช้า'
											: ticket.meal === 'lunch'
												? 'กลางวัน'
												: ticket.meal === 'dinner'
													? 'เย็น'
													: 'ว่าง'}
									</span>
								{/if}
							</td>
							<td class="px-3 py-3.5 text-sm whitespace-nowrap">
								<span
									class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium {ticket.requisition_type ===
									'food'
										? 'border border-orange-200 bg-orange-50 text-orange-700'
										: 'border border-slate-200 bg-slate-100 text-slate-700'}"
								>
									{getRequisitionTypeLabel(ticket.requisition_type as 'food' | 'supplies')}
								</span>
							</td>
							<td class="px-3 py-3.5 text-sm font-medium whitespace-nowrap text-slate-800">
								{ticket.destination_location}
							</td>
							<td class="px-3 py-3.5 text-sm whitespace-nowrap text-slate-600">
								{ticket.requested_by}
							</td>
							<td class="px-3 py-3.5 text-xs whitespace-nowrap text-slate-500 tabular-nums">
								{formatDateTime(ticket.created_at)}
							</td>
							<td class="px-3 py-3.5 text-sm whitespace-nowrap">
								<TicketStatusBadge status={ticket.status} />
							</td>
							<td class="py-3.5 pr-4 pl-3 text-right text-sm whitespace-nowrap sm:pr-6">
								<button
									type="button"
									onclick={() => handleViewDetails(ticket)}
									class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 hover:text-[#0A2647]"
								>
									<Eye class="h-3.5 w-3.5 text-slate-500" />
									<span>ดูรายละเอียด</span>
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination Footer -->
		<div
			class="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:px-6"
		>
			<div class="text-xs text-slate-500">
				แสดง <span class="font-semibold text-slate-800 tabular-nums"
					>{(currentPage - 1) * pageSize + 1}</span
				>
				ถึง
				<span class="font-semibold text-slate-800 tabular-nums"
					>{Math.min(currentPage * pageSize, totalItems)}</span
				>
				จากทั้งหมด <span class="font-semibold text-slate-800 tabular-nums">{totalItems}</span> รายการ
			</div>

			{#if totalPages > 1}
				<div class="flex items-center gap-1">
					<button
						type="button"
						disabled={currentPage === 1}
						onclick={() => (currentPage = Math.max(1, currentPage - 1))}
						class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="หน้าก่อนหน้า"
					>
						<ChevronLeft class="h-4 w-4" />
					</button>

					<span class="px-2 text-xs font-medium text-slate-700 tabular-nums">
						{currentPage} / {totalPages}
					</span>

					<button
						type="button"
						disabled={currentPage === totalPages}
						onclick={() => (currentPage = Math.min(totalPages, currentPage + 1))}
						class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="หน้าถัดไป"
					>
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
