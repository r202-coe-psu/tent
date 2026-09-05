<script lang="ts">
	import { getDistributionStore } from '../application/item-distribution-store.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import FileText from '@lucide/svelte/icons/file-text';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const store = getDistributionStore();

	function getStatusBadge(status: string) {
		switch (status) {
			case 'pending_approval':
				return {
					label: '⏱️ รอจัดส่ง/รออนุมัติ',
					class: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
				};
			case 'distributing':
				return {
					label: '🚚 กำลังแจกจ่าย',
					class: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
				};
			case 'completed':
				return {
					label: '✅ แจกจ่ายเสร็จสิ้น',
					class: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
				};
			case 'partially_returned':
				return {
					label: '🔄 ส่งคืนแล้วบางส่วน',
					class: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
				};
			case 'cancelled':
				return {
					label: '❌ ยกเลิก',
					class: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
				};
			default:
				return { label: status, class: 'bg-slate-100 text-slate-800' };
		}
	}
</script>

{#if store.selectedTicket}
	{@const ticket = store.selectedTicket}
	{@const badge = getStatusBadge(ticket.status)}
	<Dialog.Root
		open={store.detailModalOpen}
		onOpenChange={(open) => {
			if (!open) store.closeDetailModal();
		}}
	>
		<Dialog.Content class="p-0 sm:max-w-2xl">
			<Dialog.Header class="border-b p-6 pr-10 pb-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
					>
						<FileText class="size-6" />
					</div>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<Dialog.Title class="font-mono text-xl font-extrabold">
								{ticket.ticket_code}
							</Dialog.Title>
							<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold {badge.class}">
								{badge.label}
							</span>
						</div>
						<Dialog.Description class="mt-0.5 text-xs">
							{ticket.hub_name}
						</Dialog.Description>
					</div>
				</div>
			</Dialog.Header>

			<!-- Body -->
			<div class="space-y-6 px-6 pb-2">
				<!-- Meta Info Grid -->
				<div
					class="grid grid-cols-2 gap-4 rounded-xl border border-slate-200/80 bg-slate-50 p-4 text-xs sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/40"
				>
					<div>
						<span class="block font-medium text-slate-500">กลุ่มเป้าหมาย</span>
						<span class="font-bold text-slate-900 dark:text-slate-100">
							{ticket.target_group === 'evacuee' ? '👥 ผู้ประสบภัย' : '🎒 อาสาสมัคร/เจ้าหน้าที่'}
						</span>
					</div>

					<div>
						<span class="block font-medium text-slate-500">รูปแบบเบิก</span>
						<span class="font-bold text-slate-900 dark:text-slate-100">
							{ticket.distribution_mode === 'permanent' ? '🟢 เบิกขาด' : '🔄 ยืม-คืน'}
						</span>
					</div>

					<div>
						<span class="block font-medium text-slate-500">ผู้ขอเบิก</span>
						<span class="block truncate font-bold text-slate-900 dark:text-slate-100">
							{ticket.requested_by}
						</span>
					</div>

					<div>
						<span class="block font-medium text-slate-500">วันที่เบิก</span>
						<span class="font-bold text-slate-900 dark:text-slate-100">
							{ticket.created_at}
						</span>
					</div>
				</div>

				<!-- Reason / Note -->
				{#if ticket.reason}
					<div class="space-y-1">
						<h4 class="text-xs font-semibold tracking-wider text-slate-500 uppercase">
							เหตุผล / หมายเหตุคำร้อง
						</h4>
						<p
							class="rounded-lg border border-amber-200/50 bg-amber-50/50 p-3 text-sm text-slate-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-slate-200"
						>
							{ticket.reason}
						</p>
					</div>
				{/if}

				<!-- Items Table Breakdown -->
				<div class="space-y-2">
					<h4 class="text-xs font-semibold tracking-wider text-slate-500 uppercase">
						รายการพัสดุในคำขอเบิก
					</h4>
					<div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
						<table class="w-full text-left text-xs">
							<thead
								class="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
							>
								<tr>
									<th class="p-3">รายการสินค้า</th>
									<th class="p-3 text-center">ยอดเบิก</th>
									<th class="p-3 text-center">แจกจ่ายสำเร็จ</th>
									<th class="p-3 text-center">ชำรุด/สูญหาย</th>
									<th class="p-3 text-center">ส่งคืนแล้ว</th>
								</tr>
							</thead>
							<tbody
								class="divide-y divide-slate-200 text-slate-900 dark:divide-slate-800 dark:text-slate-100"
							>
								{#each ticket.items as item (item.item_id)}
									<tr>
										<td class="p-3 font-semibold">{item.name}</td>
										<td class="p-3 text-center font-bold">{item.quantity} {item.unit}</td>
										<td class="p-3 text-center font-bold text-emerald-600"
											>{item.distributed_qty} {item.unit}</td
										>
										<td class="p-3 text-center font-bold text-rose-600">{item.damaged_qty || 0}</td>
										<td class="p-3 text-center font-bold text-blue-600">{item.returned_qty || 0}</td
										>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<Dialog.Footer
				class="mx-0 mb-0 flex-row items-center justify-between rounded-b-xl border-t p-4 sm:justify-between"
			>
				{#if ticket.distribution_mode === 'borrow_return' && ticket.status !== 'completed'}
					<Button
						size="sm"
						onclick={() => {
							store.closeDetailModal();
							store.openReturnModal(ticket);
						}}
						class="gap-1.5 bg-amber-400 text-xs font-bold text-slate-900 hover:bg-amber-300"
					>
						<RotateCcw class="size-3.5" />
						<span>บันทึกการส่งคืนพัสดุ</span>
					</Button>
				{:else}
					<div></div>
				{/if}
				<Button variant="ghost" size="sm" onclick={() => store.closeDetailModal()}>
					ปิดหน้าต่าง
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
