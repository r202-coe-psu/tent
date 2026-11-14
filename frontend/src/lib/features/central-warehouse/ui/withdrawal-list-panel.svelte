<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { Snippet } from 'svelte';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { toast } from 'svelte-sonner';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { useCancelWithdrawal, useWithdrawals } from '../application/central-warehouse-queries';
	import {
		isCancellable,
		needsM6Coordination,
		shownFulfilled,
		withdrawalTotals,
		type WithdrawalView
	} from '../domain/central-warehouse.schema';
	import { formatQty, m6ErrorMessage } from './central-warehouse.ui';
	import WithdrawalStatusBadge from './withdrawal-status-badge.svelte';

	let {
		cancelEnabled,
		donationLink
	}: {
		/** False while the M6 gate is closed: the snapshot still shows, cancel is off. */
		cancelEnabled: boolean;
		/** Link to the donation intake page — the route layer renders it with `resolve()`. */
		donationLink: Snippet;
	} = $props();

	const queryClient = useQueryClient();
	const listQuery = useWithdrawals();
	const cancelMutation = useCancelWithdrawal(queryClient);
	const withdrawals = $derived(listQuery.data ?? []);

	let cancelTarget = $state<WithdrawalView | null>(null);
	let cancelReason = $state('');

	function openCancel(w: WithdrawalView) {
		cancelTarget = w;
		cancelReason = '';
	}

	async function confirmCancel() {
		const target = cancelTarget;
		if (!target) return;
		const reason = cancelReason.trim();
		if (!reason) {
			toast.error('กรุณาระบุเหตุผลที่ยกเลิก');
			return;
		}
		try {
			await cancelMutation.mutateAsync({ requestCode: target.request_code, reason });
			toast.success(`ยกเลิกใบเบิก ${target.request_code} แล้ว`);
		} catch (e) {
			toast.error(m6ErrorMessage(e));
		} finally {
			cancelTarget = null;
		}
	}

	const when = (iso: string | null | undefined) => (iso ? formatThaiDateTime(iso) : '–');
</script>

<section aria-label="คำขอของศูนย์" class="space-y-3">
	{#if listQuery.isPending}
		<div class="space-y-3">
			{#each [1, 2] as n (n)}
				<Skeleton class="h-40 w-full rounded-xl" />
			{/each}
		</div>
	{:else if listQuery.isError && withdrawals.length === 0}
		<div
			class="space-y-2 rounded-xl border border-red-200 bg-white p-4 text-sm text-red-900"
			role="alert"
		>
			<p>โหลดคำขอของศูนย์ไม่สำเร็จ: {listQuery.error.message}</p>
			<Button variant="outline" class="h-11" onclick={() => listQuery.refetch()}>ลองใหม่</Button>
		</div>
	{:else if withdrawals.length === 0}
		<div
			class="flex flex-col items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-8 text-center text-slate-500 shadow-2xs"
		>
			<ClipboardList class="h-8 w-8" aria-hidden="true" />
			<p class="text-sm">ศูนย์นี้ยังไม่เคยขอเบิกจากคลังกลาง</p>
		</div>
	{:else}
		<ul class="space-y-3">
			{#each withdrawals as w (w.external_ref)}
				{@const totals = withdrawalTotals(w)}
				<li class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div class="min-w-0">
							<p class="text-base font-bold text-slate-900 tabular-nums">{w.request_code}</p>
							<p class="text-sm text-slate-500">
								จาก {w.source_warehouse_name ?? w.source_warehouse_code}
								{#if w.requested_by?.name}
									· ผู้ขอ {w.requested_by.name}{/if}
							</p>
						</div>
						<WithdrawalStatusBadge status={w.status} />
					</div>

					{#if needsM6Coordination(w.status)}
						<p class="flex items-start gap-2 text-sm font-semibold text-red-900">
							<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
							ประสาน M6 เพื่อสอบถามการจัดส่ง
						</p>
					{/if}

					<div class="overflow-x-auto rounded-lg border border-slate-200">
						<table class="w-full text-sm">
							<caption class="sr-only">รายการในใบเบิก {w.request_code}</caption>
							<thead class="bg-slate-50 text-left text-xs font-semibold text-slate-600">
								<tr>
									<th scope="col" class="px-3 py-2">สิ่งของ</th>
									<th scope="col" class="px-3 py-2 text-right">ขอ</th>
									<th scope="col" class="px-3 py-2 text-right">M6 จ่ายจริง</th>
									<th scope="col" class="px-3 py-2">หน่วย</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each w.lines as l (l.item_code)}
									<tr>
										<td class="px-3 py-2 text-slate-900">{l.name}</td>
										<td class="px-3 py-2 text-right text-slate-700 tabular-nums">
											{formatQty(l.qty)}
										</td>
										<td class="px-3 py-2 text-right font-semibold text-slate-900 tabular-nums">
											{formatQty(shownFulfilled(w.status, l.qty_fulfilled))}
										</td>
										<td class="px-3 py-2 text-slate-700">{l.unit}</td>
									</tr>
								{/each}
							</tbody>
							{#if w.lines.length > 1}
								<tfoot class="bg-slate-50 text-xs font-semibold text-slate-700">
									<tr>
										<td class="px-3 py-2">รวม</td>
										<td class="px-3 py-2 text-right tabular-nums">{formatQty(totals.requested)}</td>
										<td class="px-3 py-2 text-right tabular-nums">
											{formatQty(totals.fulfilled)}
										</td>
										<td></td>
									</tr>
								</tfoot>
							{/if}
						</table>
					</div>

					<dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
						<div>
							<dt class="text-xs font-semibold text-slate-500">ส่งคำขอ</dt>
							<dd class="text-slate-800 tabular-nums">{when(w.submitted_at ?? w.created_at)}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold text-slate-500">M6 อนุมัติ</dt>
							<dd class="text-slate-800 tabular-nums">{when(w.approved_at)}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold text-slate-500">เสร็จสิ้น</dt>
							<dd class="text-slate-800 tabular-nums">{when(w.completed_at)}</dd>
						</div>
					</dl>

					{#if w.reason}
						<p class="text-sm text-slate-700">
							<span class="font-semibold">เหตุผล:</span>
							{w.reason}
						</p>
					{/if}
					{#if w.status === 'cancelled' && w.cancel_reason}
						<p class="text-sm text-slate-700">
							<span class="font-semibold">เหตุผลที่ยกเลิก:</span>
							{w.cancel_reason}
						</p>
					{/if}

					{#if w.donation_id}
						<p class="text-sm text-slate-700">
							ของจากใบนี้เข้าเป็นรายการบริจาคแล้ว รับของที่
							{@render donationLink()}
							{#if w.confirm_error}
								<span class="mt-1 flex items-start gap-1.5 font-semibold text-amber-900">
									<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
									ยังยืนยันกับ M6 ไม่สำเร็จ ระบบจะลองใหม่เอง
								</span>
							{/if}
						</p>
					{/if}

					{#if isCancellable(w.status)}
						<div>
							<Button
								variant="outline"
								class="h-11 gap-2 border-red-200 text-red-700 hover:bg-red-50"
								disabled={!cancelEnabled || cancelMutation.isPending}
								onclick={() => openCancel(w)}
							>
								<Undo2 class="h-4 w-4" aria-hidden="true" />
								ยกเลิกใบเบิก
							</Button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="text-xs text-slate-500">สถานะอัปเดตเองทุก 30 วินาที ตามที่ M6 ดำเนินการ</p>
	{/if}
</section>

<Dialog.Root open={cancelTarget !== null} onOpenChange={(o) => !o && (cancelTarget = null)}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>ยกเลิกใบเบิก {cancelTarget?.request_code}</Dialog.Title>
			<Dialog.Description>
				ยกเลิกได้เฉพาะใบที่ M6 ยังไม่พิจารณา ถ้า M6 พิจารณาไปแล้วระบบจะแจ้งให้ประสาน M6
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-1.5">
			<Label for="m6-cancel-reason" class="text-sm font-semibold text-slate-700">
				เหตุผล <span class="text-red-600">*</span>
			</Label>
			<Textarea id="m6-cancel-reason" rows={3} maxlength={2000} bind:value={cancelReason} />
		</div>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="h-11" onclick={() => (cancelTarget = null)}>ปิด</Button>
			<Button
				class="h-11 bg-red-600 text-white hover:bg-red-700"
				disabled={cancelMutation.isPending}
				onclick={confirmCancel}
			>
				ยืนยันยกเลิก
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
