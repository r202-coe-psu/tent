<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		resolveAuthenticatedAuthorContext,
		useApproveTicketForDispatch
	} from '../../application/queries';
	import {
		canAllocateTicket,
		canApproveTicket,
		canCancelTicket
	} from '../../application/food-supplies/auth';
	import { isTicketReadyForApproval } from '../model/ticket-lifecycle';
	import TicketAllocationDialog from './TicketAllocationDialog.svelte';
	import CancelTicketDialog from './CancelTicketDialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import Boxes from '@lucide/svelte/icons/boxes';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Ban from '@lucide/svelte/icons/ban';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Info from '@lucide/svelte/icons/info';

	interface Props {
		ticket: RequisitionTicket;
		shelterCode: string;
		onActionSuccess?: () => void;
	}

	let { ticket, shelterCode, onActionSuccess }: Props = $props();

	// Modal states
	let isAllocateOpen = $state(false);
	let isCancelOpen = $state(false);
	let isApproveConfirmOpen = $state(false);

	const approveMutation = useApproveTicketForDispatch();

	// Authoritative capabilities derived from session
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(shelterCode);
		} catch {
			return null;
		}
	});

	const canAllocate = $derived(authContext ? canAllocateTicket(authContext) : false);
	const canApprove = $derived(authContext ? canApproveTicket(authContext) : false);
	const canCancel = $derived(authContext ? canCancelTicket(authContext) : false);

	// Approval readiness check
	const approvalReadiness = $derived(isTicketReadyForApproval(ticket));

	const isAnyPending = $derived(approveMutation.isPending);

	async function handleConfirmApprove() {
		try {
			await approveMutation.mutateAsync({
				ticketId: ticket._id,
				shelterCode
			});

			toast.success(`อนุมัติใบเบิกจ่าย ${ticket.ticket_no} ให้พร้อมส่งออกแล้ว`);
			isApproveConfirmOpen = false;
			onActionSuccess?.();
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอนุมัติตั๋ว';
			toast.error(msg);
		}
	}
</script>

<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5">
	<div class="flex items-center justify-between border-b border-slate-100 pb-3">
		<div>
			<h3 class="text-sm font-bold text-slate-900">การดำเนินการ (Action Panel)</h3>
			<p class="text-2xs text-slate-500">
				คำสั่งที่สามารถดำเนินการได้ตามสถานะของตั๋วและสิทธิ์ของผู้ใช้งาน
			</p>
		</div>
	</div>

	<div class="mt-4">
		{#if ticket.status === 'PENDING_PICK'}
			<!-- PENDING_PICK Workflow Actions (Slice 5.2) -->
			<div class="space-y-4">
				<div class="flex flex-wrap items-center gap-3">
					<!-- Action 1: Allocate Quantities -->
					{#if canAllocate}
						<button
							type="button"
							disabled={isAnyPending}
							onclick={() => (isAllocateOpen = true)}
							class="inline-flex h-10 items-center gap-2 rounded-xl border border-[#0A2647] bg-white px-4 text-xs font-semibold text-[#0A2647] shadow-2xs transition-colors hover:bg-[#0A2647]/5 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Boxes class="h-4 w-4" />
							<span>จัดสรรยอดสินค้า</span>
						</button>
					{/if}

					<!-- Action 2: Approve for Dispatch -->
					{#if canApprove}
						<button
							type="button"
							disabled={!approvalReadiness.ready || isAnyPending}
							onclick={() => (isApproveConfirmOpen = true)}
							class="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0A2647] px-4 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930] disabled:cursor-not-allowed disabled:opacity-50"
							title={approvalReadiness.ready ? 'อนุมัติให้ปล่อยของ' : approvalReadiness.reason}
						>
							{#if approveMutation.isPending}
								<Loader2 class="h-4 w-4 animate-spin" />
								<span>กำลังอนุมัติ...</span>
							{:else}
								<CheckCircle2 class="h-4 w-4" />
								<span>อนุมัติให้ปล่อยของ</span>
							{/if}
						</button>
					{/if}

					<!-- Action 3: Cancel Ticket -->
					{#if canCancel}
						<button
							type="button"
							disabled={isAnyPending}
							onclick={() => (isCancelOpen = true)}
							class="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700 shadow-2xs transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Ban class="h-4 w-4" />
							<span>ยกเลิกตั๋ว</span>
						</button>
					{/if}
				</div>

				<!-- Helper note for approval readiness if not ready -->
				{#if canApprove && !approvalReadiness.ready}
					<div
						class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-800"
					>
						<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
						<span>{approvalReadiness.reason}</span>
					</div>
				{/if}
			</div>
		{:else if ticket.status === 'READY_FOR_DISPATCH'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-900"
			>
				<Info class="h-4 w-4 shrink-0 text-sky-600" />
				<div>
					<strong>อนุมัติให้ปล่อยของแล้ว (พร้อมส่งออก)</strong>
					<p class="mt-0.5 text-slate-600">
						รอเจ้าหน้าที่คลังจัดสินค้าและเลือก Physical Lot เพื่อปล่อยรถนำส่งไปยังจุดแจกจ่าย (Slice
						5.3)
					</p>
				</div>
			</div>
		{:else if ticket.status === 'IN_TRANSIT'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900"
			>
				<Info class="h-4 w-4 shrink-0 text-blue-600" />
				<div>
					<strong>กำลังนำส่ง (In Transit)</strong>
					<p class="mt-0.5 text-slate-600">
						สินค้าอยู่ระหว่างการเดินทางไปยัง {ticket.destination_location} (รอเจ้าหน้าที่จุดแจกยืนยันรับของ)
					</p>
				</div>
			</div>
		{:else if ticket.status === 'DISTRIBUTING'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900"
			>
				<Info class="h-4 w-4 shrink-0 text-emerald-600" />
				<div>
					<strong>เปิดแจกจ่ายแล้ว (Distributing)</strong>
					<p class="mt-0.5 text-slate-600">
						การแจกจ่ายผู้พักพิงดำเนินอยู่ที่สถานี Onsite Distribution ตามโควตามื้ออาหารและพัสดุ
					</p>
				</div>
			</div>
		{:else if ticket.status === 'SHIFT_CLOSED'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-purple-200 bg-purple-50/60 p-3 text-xs text-purple-900"
			>
				<Info class="h-4 w-4 shrink-0 text-purple-600" />
				<div>
					<strong>ปิดรอบแจกจ่ายแล้ว (Shift Closed)</strong>
					<p class="mt-0.5 text-slate-600">
						จุดแจกปิดรอบและกระทบยอดแล้ว อยู่ระหว่างรอส่งของเหลือคืนคลังสินค้า (ถ้ามี)
					</p>
				</div>
			</div>
		{:else if ticket.status === 'RETURN_PENDING_RECEIPT'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-xs text-orange-900"
			>
				<Info class="h-4 w-4 shrink-0 text-orange-600" />
				<div>
					<strong>รอคลังตรวจรับคืน (Returns Pending Receipt)</strong>
					<p class="mt-0.5 text-slate-600">
						ของเหลือถูกส่งกลับมาที่คลังแล้ว รอเจ้าหน้าที่คลังตรวจนับและรับเข้าสต็อก
					</p>
				</div>
			</div>
		{:else if ticket.status === 'RETURN_COMPLETED'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900"
			>
				<Info class="h-4 w-4 shrink-0 text-teal-600" />
				<div>
					<strong>ตรวจรับคืนเรียบร้อยแล้ว (Return Completed)</strong>
					<p class="mt-0.5 text-slate-600">
						คลังบันทึกยอดรับคืนเข้าคลังเรียบร้อยแล้ว รอการปิดตั๋วอย่างสมบูรณ์
					</p>
				</div>
			</div>
		{:else if ticket.status === 'COMPLETED'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
			>
				<CheckCircle2 class="h-4 w-4 shrink-0 text-emerald-600" />
				<div>
					<strong>ตั๋วเสร็จสมบูรณ์แล้ว (Read-Only)</strong>
					<p class="mt-0.5 text-slate-500">
						การแจกจ่าย การกระทบยอด และการคืนของเสร็จสมบูรณ์เรียบร้อยแล้ว เอกสารนี้อยู่ในสถานะปิดรอบ
					</p>
				</div>
			</div>
		{:else if ticket.status === 'CANCELLED'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs text-red-900"
			>
				<Ban class="h-4 w-4 shrink-0 text-red-600" />
				<div>
					<strong>ตั๋วนี้ถูกยกเลิกแล้ว (Read-Only)</strong>
					<p class="mt-0.5 text-red-700">
						ตั๋วถูกยกเลิกก่อนการปล่อยของ {ticket.notes ? `(เหตุผล: ${ticket.notes})` : ''}
					</p>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Modal 1: Allocation Dialog -->
<TicketAllocationDialog
	bind:open={isAllocateOpen}
	{ticket}
	{shelterCode}
	onSuccess={onActionSuccess}
	onClose={() => (isAllocateOpen = false)}
/>

<!-- Modal 2: Cancel Ticket Dialog -->
<CancelTicketDialog
	bind:open={isCancelOpen}
	{ticket}
	{shelterCode}
	onSuccess={onActionSuccess}
	onClose={() => (isCancelOpen = false)}
/>

<!-- Modal 3: Approval Confirmation Dialog -->
<Dialog.Root bind:open={isApproveConfirmOpen}>
	<Dialog.Content class="sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
				<CheckCircle2 class="h-5 w-5 text-emerald-600" />
				<span>ยืนยันการอนุมัติปล่อยของ</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-slate-500">
				ต้องการอนุมัติใบเบิกจ่าย <strong class="font-mono text-slate-800">{ticket.ticket_no}</strong
				> ให้เปลี่ยนสถานะเป็น "พร้อมส่งออก" (READY_FOR_DISPATCH) ใช่หรือไม่?
			</Dialog.Description>
		</Dialog.Header>

		<div class="my-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
			<div class="flex justify-between">
				<span class="text-slate-500">จุดหมาย:</span>
				<span class="font-semibold text-slate-800">{ticket.destination_location}</span>
			</div>
			<div class="mt-1 flex justify-between">
				<span class="text-slate-500">จำนวนรายการ:</span>
				<span class="font-semibold text-slate-800">{ticket.items.length} รายการ</span>
			</div>
			<div class="mt-1 flex justify-between">
				<span class="text-slate-500">ผู้อนุมัติ (Session):</span>
				<span class="font-mono text-slate-800">{authContext?.createdBy ?? '-'}</span>
			</div>
		</div>

		<Dialog.Footer class="flex items-center justify-end gap-2">
			<button
				type="button"
				onclick={() => (isApproveConfirmOpen = false)}
				class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
			>
				ยกเลิก
			</button>
			<button
				type="button"
				onclick={handleConfirmApprove}
				disabled={approveMutation.isPending}
				class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A2647] px-4 text-xs font-semibold text-white shadow-2xs hover:bg-[#051930] disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if approveMutation.isPending}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					<span>กำลังอนุมัติ...</span>
				{:else}
					<span>ยืนยันอนุมัติ</span>
				{/if}
			</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
