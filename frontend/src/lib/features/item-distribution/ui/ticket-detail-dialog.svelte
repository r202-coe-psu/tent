<script lang="ts">
	import { getDistributionStore } from '../application/item-distribution-store.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Calculator from '@lucide/svelte/icons/calculator';
	import Clock from '@lucide/svelte/icons/clock';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Truck from '@lucide/svelte/icons/truck';
	import XCircle from '@lucide/svelte/icons/x-circle';

	const store = getDistributionStore();

	function getStatusBadge(status: string) {
		switch (status) {
			case 'pending_approval':
				return {
					label: 'รอคลังอนุมัติ',
					icon: Clock,
					class: 'border-amber-300 bg-[#FFF9EC] text-amber-800'
				};
			case 'distributing':
				return {
					label: 'กำลังแจกจ่าย',
					icon: Truck,
					class: 'border-blue-300 bg-blue-50/80 text-blue-800'
				};
			case 'completed':
				return {
					label: 'แจกจ่ายสำเร็จ',
					icon: CheckCircle2,
					class: 'border-emerald-300 bg-emerald-50/80 text-emerald-800'
				};
			case 'partially_returned':
				return {
					label: 'ส่งคืนแล้วบางส่วน',
					icon: RotateCcw,
					class: 'border-indigo-300 bg-indigo-50/80 text-indigo-800'
				};
			case 'cancelled':
				return {
					label: 'ยกเลิกคำขอ',
					icon: XCircle,
					class: 'border-rose-300 bg-rose-50/80 text-rose-800'
				};
			default:
				return {
					label: status,
					icon: Clock,
					class: 'border-slate-300 bg-slate-50 text-slate-800'
				};
		}
	}

	function getAuditTime(timestamp?: string) {
		if (!timestamp) return '20:07';
		const match = timestamp.match(/\b\d{1,2}:\d{2}\b/);
		return match ? match[0] : timestamp;
	}
</script>

{#if store.selectedTicket}
	{@const ticket = store.selectedTicket}
	{@const badge = getStatusBadge(ticket.status)}
	{@const itemName =
		ticket.items && ticket.items.length > 0
			? ticket.items.length === 1
				? ticket.items[0].name
				: ticket.items.map((i) => i.name).join(', ')
			: 'พัสดุช่วยเหลือ'}
	{@const itemUnit = ticket.items?.[0]?.unit || 'ชิ้น'}
	{@const requestNote =
		ticket.reason ||
		`คำร้องขอเบิกพัสดุเพื่อแจกจ่ายช่วยเหลือ${ticket.target_group === 'volunteer' ? 'อาสาสมัคร' : 'ผู้ประสบภัย'} [โหมด: ${ticket.distribution_mode === 'permanent' ? 'แจกจ่ายขาด' : 'ยืม-คืน'}] (${ticket.items?.length || 1} รายการ)`}

	<Dialog.Root
		open={store.detailModalOpen}
		onOpenChange={(open) => {
			if (!open) store.closeDetailModal();
		}}
	>
		<Dialog.Content
			class="w-full max-w-[95vw] rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl sm:max-w-[720px] sm:p-7 [&_[data-slot=dialog-close]]:top-6 [&_[data-slot=dialog-close]]:right-6 [&_[data-slot=dialog-close]]:text-slate-400 [&_[data-slot=dialog-close]]:hover:text-slate-600"
		>
			<!-- Header -->
			<div class="flex items-center gap-3.5 border-b border-slate-100 pb-5">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600"
				>
					<ClipboardList class="size-6 stroke-[1.8]" />
				</div>
				<div class="min-w-0 pr-8">
					<Dialog.Title class="text-xl font-bold tracking-tight text-slate-800">
						รายละเอียดคำขอเบิกพัสดุช่วยเหลือ
					</Dialog.Title>
				</div>
			</div>

			<!-- Body -->
			<div class="space-y-4 pt-1">
				<!-- Card 1: Ticket Info & Status -->
				<div
					class="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:flex-row sm:items-center"
				>
					<div class="space-y-1">
						<div class="flex flex-wrap items-center gap-2.5">
							<span class="text-xl font-bold tracking-tight whitespace-nowrap text-slate-900">
								{ticket.ticket_code}
							</span>
							<span
								class="inline-flex items-center gap-1 rounded-md border border-blue-100/80 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-blue-600"
							>
								<span>📦</span>
								<span
									>{ticket.distribution_mode === 'permanent' ? 'คำขอเบิกจ่าย' : 'คำขอยืม-คืน'}</span
								>
							</span>
						</div>
						<div class="text-base font-bold text-slate-800">
							{itemName}
						</div>
					</div>

					<div class="shrink-0">
						<div
							class="inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold whitespace-nowrap {badge.class}"
						>
							<badge.icon class="size-4 shrink-0 stroke-[2.2]" />
							<span>{badge.label}</span>
						</div>
					</div>
				</div>

				<!-- Card 2: สมการสรุปดุลยอดพัสดุ (Reconciliation Breakdown) -->
				<div class="space-y-3.5 rounded-2xl border border-blue-100 bg-[#F5F9FF] p-5">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-base font-bold text-slate-800">
							<Calculator class="size-4.5 stroke-[1.9] text-slate-700" />
							<span>สมการสรุปดุลยอดพัสดุ (Reconciliation Breakdown)</span>
						</div>
						<span class="shrink-0 text-sm font-bold text-blue-600">{itemUnit}</span>
					</div>

					<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<!-- ยอดเบิกทั้งหมด -->
						<div
							class="rounded-xl border border-blue-200 bg-white px-2 py-3.5 text-center shadow-2xs"
						>
							<span class="block text-xs font-medium text-slate-500">ยอดเบิกทั้งหมด</span>
							<span class="mt-1 block text-2xl font-black text-slate-800 tabular-nums">
								{ticket.total_requested}
							</span>
						</div>

						<!-- แจกจ่ายสำเร็จ -->
						<div
							class="rounded-xl border border-emerald-200 bg-[#EEFBF4] px-2 py-3.5 text-center shadow-2xs"
						>
							<span class="block text-xs font-semibold text-emerald-700">แจกจ่ายสำเร็จ</span>
							<span class="mt-1 block text-2xl font-black text-emerald-600 tabular-nums">
								{ticket.total_distributed}
							</span>
						</div>

						<!-- ชำรุด/สูญหาย -->
						<div
							class="rounded-xl border border-rose-200 bg-[#FFF2F4] px-2 py-3.5 text-center shadow-2xs"
						>
							<span class="block text-xs font-semibold text-rose-600">ชำรุด/สูญหาย</span>
							<span class="mt-1 block text-2xl font-black text-rose-600 tabular-nums">
								{ticket.total_damaged || 0}
							</span>
						</div>

						<!-- ยอดคืนสุทธิ -->
						<div
							class="rounded-xl border border-blue-200 bg-[#EDF5FF] px-2 py-3.5 text-center shadow-2xs"
						>
							<span class="block text-xs font-semibold text-blue-700">ยอดคืนสุทธิ</span>
							<span class="mt-1 block text-2xl font-black text-blue-600 tabular-nums">
								{ticket.total_returned || 0}
							</span>
						</div>
					</div>
				</div>

				<!-- Card 3: รายละเอียดคำร้อง/บันทึกหมายเหตุ -->
				<div class="space-y-1.5 rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-4.5">
					<h4 class="text-sm font-bold text-slate-800">รายละเอียดคำร้อง/บันทึกหมายเหตุ:</h4>
					<p class="text-sm leading-relaxed font-normal text-slate-600">
						{requestNote}
					</p>
				</div>

				<!-- Section 4: ประวัติการดำเนินการ (Audit Trail) -->
				<div class="space-y-2">
					<h4 class="text-sm font-bold text-slate-900">ประวัติการดำเนินการ (Audit Trail):</h4>
					<div class="space-y-1 rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3.5">
						<div class="flex items-center justify-between gap-2 text-sm">
							<div class="min-w-0">
								<span class="font-bold text-slate-800">Created Requisition</span>
								<span class="text-slate-500">
									โดย {ticket.requested_by || 'คุณ (เจ้าหน้าที่แจกจ่ายหน้างาน)'}
								</span>
							</div>
							<span class="shrink-0 text-xs font-medium text-slate-400 tabular-nums">
								{getAuditTime(ticket.created_at)}
							</span>
						</div>
						<p class="text-xs leading-relaxed text-slate-500">
							สร้างคำร้องขอเบิกพัสดุเพื่อเตรียมแจกจ่ายช่วยเหลือ{ticket.target_group === 'volunteer'
								? 'อาสาสมัคร'
								: 'ผู้ประสบภัย'}หน้างาน (โหมด: {ticket.distribution_mode === 'permanent'
								? 'แจกจ่ายขาด'
								: 'ยืม-คืน'})
						</p>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="mt-5 flex items-center justify-between">
				{#if ticket.distribution_mode === 'borrow_return' && ticket.status !== 'completed'}
					<Button
						size="sm"
						onclick={() => {
							store.closeDetailModal();
							store.openReturnModal(ticket);
						}}
						class="gap-1.5 rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-slate-900 hover:bg-amber-300"
					>
						<RotateCcw class="size-3.5" />
						<span>บันทึกการส่งคืนพัสดุ</span>
					</Button>
				{:else}
					<div></div>
				{/if}

				<Button
					variant="ghost"
					onclick={() => store.closeDetailModal()}
					class="rounded-xl bg-[#F1F5F9] px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
				>
					ปิดหน้าต่าง
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Root>
{/if}
