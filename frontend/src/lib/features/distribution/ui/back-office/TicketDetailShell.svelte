<script lang="ts">
	import { useRequisitionTicket } from '../../application/queries';
	import TicketStatusBadge from '../common/TicketStatusBadge.svelte';
	import TicketLifecycleProgress from '../common/TicketLifecycleProgress.svelte';
	import TicketActionPanel from './TicketActionPanel.svelte';
	import { getReturnableBadgeLabel, getReturnableBadgeClass } from '../model/catalog-eligibility';
	import { getRequisitionTypeLabel } from '../model/ticket-status';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import User from '@lucide/svelte/icons/user';
	import Calendar from '@lucide/svelte/icons/calendar';

	interface Props {
		ticketId: string;
		shelterCode: string;
		onClose: () => void;
	}

	let { ticketId, shelterCode, onClose }: Props = $props();

	// Remote-First authoritative query
	const ticketQuery = useRequisitionTicket(
		() => ticketId,
		() => shelterCode
	);

	const ticket = $derived(ticketQuery.data);
	const isLoading = $derived(ticketQuery.isLoading);
	const isError = $derived(ticketQuery.isError);

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
</script>

<Dialog.Root
	open={Boolean(ticketId)}
	onOpenChange={(next) => {
		if (!next) onClose();
	}}
>
	<Dialog.Content
		class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[850px] lg:max-w-[950px]"
	>
		{#if isLoading}
			<div class="flex flex-col items-center justify-center p-16 text-center">
				<Loader2 class="mb-3 h-8 w-8 animate-spin text-[#0A2647]" />
				<h4 class="text-sm font-semibold text-slate-800">กำลังดึงข้อมูลตั๋วเบิกจ่าย...</h4>
				<p class="mt-0.5 text-xs text-slate-500">กรุณารอสักครู่ (Remote-First Query)</p>
			</div>
		{:else if isError || !ticket}
			<div class="flex flex-col items-center justify-center p-12 text-center">
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600"
				>
					<AlertCircle class="h-6 w-6" />
				</div>
				<h3 class="text-base font-bold text-slate-900">ไม่พบตั๋วเบิกจ่ายหรือเกิดข้อผิดพลาด</h3>
				<p class="mt-1 max-w-md text-xs text-slate-500">
					ไม่สามารถเรียกดูข้อมูลตั๋วรหัส <span class="font-mono font-semibold">{ticketId}</span> จากฐานข้อมูลได้
					กรุณาตรวจสอบเครือข่ายหรือกลับสู่หน้ารายการ
				</p>
				<button
					type="button"
					onclick={onClose}
					class="mt-5 inline-flex h-9 items-center rounded-lg bg-[#0A2647] px-4 text-xs font-semibold text-white shadow-2xs hover:bg-[#051930]"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		{:else}
			<!-- Header -->
			<div class="border-b border-slate-200/80 bg-white px-6 pt-6 pb-4">
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div class="flex flex-wrap items-center gap-2.5">
						<Dialog.Title class="text-xl font-bold tracking-tight text-slate-900">
							<span class="font-mono text-[#0A2647]">{ticket.ticket_no}</span>
						</Dialog.Title>

						<!-- Requisition type badge -->
						<span
							class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium {ticket.requisition_type ===
							'food'
								? 'border border-orange-200 bg-orange-50 text-orange-700'
								: 'border border-slate-200 bg-slate-100 text-slate-700'}"
						>
							{getRequisitionTypeLabel(ticket.requisition_type as 'food' | 'supplies')}
						</span>

						<!-- Meal period (if food) -->
						{#if ticket.meal}
							<span
								class="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
							>
								มื้อ{ticket.meal === 'breakfast'
									? 'เช้า'
									: ticket.meal === 'lunch'
										? 'กลางวัน'
										: ticket.meal === 'dinner'
											? 'เย็น'
											: 'อาหารว่าง'}
							</span>
						{/if}

						<!-- Canonical Status Badge -->
						<TicketStatusBadge status={ticket.status} />
					</div>

					<Dialog.Description class="sr-only">
						รายละเอียดใบเบิกจ่าย {ticket.ticket_no}
					</Dialog.Description>
				</div>

				<!-- Quick Metadata Bar -->
				<div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
					<div class="flex items-center gap-1.5">
						<MapPin class="h-3.5 w-3.5 text-slate-400" />
						<span
							>จุดหมาย: <strong class="text-slate-900">{ticket.destination_location}</strong></span
						>
					</div>

					<div class="flex items-center gap-1.5">
						<User class="h-3.5 w-3.5 text-slate-400" />
						<span>ผู้ขอ: <strong class="text-slate-900">{ticket.requested_by}</strong></span>
					</div>

					<div class="flex items-center gap-1.5">
						<Calendar class="h-3.5 w-3.5 text-slate-400" />
						<span
							>วันที่สร้าง: <span class="tabular-nums">{formatDateTime(ticket.created_at)}</span
							></span
						>
					</div>

					{#if ticket.approved_by}
						<div class="flex items-center gap-1.5">
							<span class="text-slate-400">•</span>
							<span>ผู้อนุมัติ: <strong class="text-slate-900">{ticket.approved_by}</strong></span>
						</div>
					{/if}

					{#if ticket.dispatched_by}
						<div class="flex items-center gap-1.5">
							<span class="text-slate-400">•</span>
							<span
								>ผู้ปล่อยของ: <strong class="text-slate-900">{ticket.dispatched_by}</strong></span
							>
						</div>
					{/if}

					{#if ticket.driver_name || ticket.license_plate}
						<div class="flex items-center gap-1.5">
							<span class="text-slate-400">•</span>
							<span
								>ขนส่ง: <strong class="text-slate-900"
									>{ticket.driver_name ?? '-'}{ticket.license_plate
										? ` (${ticket.license_plate})`
										: ''}</strong
								></span
							>
						</div>
					{/if}

					{#if ticket.received_by}
						<div class="flex items-center gap-1.5">
							<span class="text-slate-400">•</span>
							<span>ผู้รับมอบ: <strong class="text-slate-900">{ticket.received_by}</strong></span>
						</div>
					{/if}
				</div>
			</div>

			<!-- Scrollable Content Body -->
			<div class="flex-1 space-y-6 overflow-y-auto bg-slate-50/40 p-6">
				<!-- 1. Lifecycle Progress -->
				<TicketLifecycleProgress status={ticket.status} cancellationReason={ticket.notes} />

				<!-- 2. Line Items Table -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-bold text-slate-900">
							รายการสินค้าในตั๋ว ({ticket.items.length} รายการ)
						</h3>
					</div>

					<div class="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs">
						<table class="w-full min-w-[500px] text-left text-sm">
							<thead
								class="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold tracking-wider text-slate-600 uppercase"
							>
								<tr>
									<th scope="col" class="py-2.5 pr-2 pl-4">ชื่อรายการ</th>
									<th scope="col" class="px-2 py-2.5 text-center">ประเภท</th>
									<th scope="col" class="px-3 py-2.5 text-right">ยอดที่ขอ</th>
									<th scope="col" class="px-3 py-2.5 text-right">ยอดที่จัดสรร</th>
									{#if ticket.status !== 'PENDING_PICK' && ticket.status !== 'READY_FOR_DISPATCH' && ticket.status !== 'CANCELLED'}
										<th scope="col" class="py-2.5 pr-4 pl-3 text-right">แจกแล้ว</th>
									{/if}
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each ticket.items as item (item.item_id)}
									<tr class="hover:bg-slate-50/50">
										<td class="py-3 pr-2 pl-4">
											<div class="font-bold text-slate-900">{item.item_name}</div>
											<div class="font-mono text-2xs text-slate-400">ID: {item.item_id}</div>
										</td>
										<td class="px-2 py-3 text-center">
											<span
												class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {getReturnableBadgeClass(
													item.returnable
												)}"
											>
												{getReturnableBadgeLabel(item.returnable)}
											</span>
										</td>
										<td
											class="px-3 py-3 text-right text-xs font-medium text-slate-600 tabular-nums"
										>
											{item.requested_qty}
										</td>
										<td class="px-3 py-3 text-right text-xs tabular-nums">
											{#if item.allocated_qty}
												<span class="font-bold text-slate-900">{item.allocated_qty}</span>
											{:else}
												<span class="text-slate-400">-</span>
											{/if}
										</td>
										{#if ticket.status !== 'PENDING_PICK' && ticket.status !== 'READY_FOR_DISPATCH' && ticket.status !== 'CANCELLED'}
											<td
												class="py-3 pr-4 pl-3 text-right text-xs font-medium text-slate-700 tabular-nums"
											>
												{item.distributed_qty ?? '0'}
											</td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>

				<!-- 3. Action Panel -->
				<TicketActionPanel
					{ticket}
					{shelterCode}
					onActionSuccess={() => {
						ticketQuery.refetch();
					}}
				/>
			</div>

			<!-- Footer -->
			<div class="flex justify-end border-t border-slate-200 bg-white px-6 py-3.5">
				<button
					type="button"
					onclick={onClose}
					class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
