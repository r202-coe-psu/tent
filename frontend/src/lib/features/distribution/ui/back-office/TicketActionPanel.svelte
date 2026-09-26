<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		resolveAuthenticatedAuthorContext,
		useApproveTicketForDispatch,
		useReceiveTicketAtDistributionPoint,
		useCompleteTicket
	} from '../../application/queries';
	import {
		canAllocateTicket,
		canApproveTicket,
		canCancelTicket,
		canDispatchTicket,
		canPerformFrontlineDistribution,
		canReceiveWarehouseReturns
	} from '../../application/food-supplies/auth';
	import { isTicketReadyForApproval } from '../model/ticket-lifecycle';
	import { formatDistributionError } from '../model/distribution-error';
	import TicketAllocationDialog from './TicketAllocationDialog.svelte';
	import CancelTicketDialog from './CancelTicketDialog.svelte';
	import DispatchTicketDialog from './DispatchTicketDialog.svelte';
	import WarehouseReturnDialog from './WarehouseReturnDialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import Boxes from '@lucide/svelte/icons/boxes';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Ban from '@lucide/svelte/icons/ban';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Info from '@lucide/svelte/icons/info';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

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
	let isDispatchOpen = $state(false);
	let isReceiveConfirmOpen = $state(false);
	let isWarehouseReturnOpen = $state(false);
	let isCompleteConfirmOpen = $state(false);

	const approveMutation = useApproveTicketForDispatch();
	const receiveMutation = useReceiveTicketAtDistributionPoint();
	const completeMutation = useCompleteTicket();

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
	const canDispatch = $derived(authContext ? canDispatchTicket(authContext) : false);
	const canReceive = $derived(authContext ? canPerformFrontlineDistribution(authContext) : false);
	const canReceiveReturns = $derived(authContext ? canReceiveWarehouseReturns(authContext) : false);

	// Approval readiness check
	const approvalReadiness = $derived(isTicketReadyForApproval(ticket));

	const isAnyPending = $derived(
		approveMutation.isPending || receiveMutation.isPending || completeMutation.isPending
	);

	async function handleConfirmComplete() {
		try {
			await completeMutation.mutateAsync({
				ticketId: ticket._id,
				shelterCode
			});

			toast.success(`ปิดตั๋วใบเบิกจ่าย ${ticket.ticket_no} เสร็จสมบูรณ์แล้ว`);
			isCompleteConfirmOpen = false;
			onActionSuccess?.();
		} catch (err) {
			const msg = formatDistributionError(err, 'เกิดข้อผิดพลาดในการปิดตั๋ว กรุณาลองใหม่อีกครั้ง');
			toast.error(msg);
		}
	}

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
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการอนุมัติตั๋ว กรุณาลองใหม่อีกครั้ง'
			);
			toast.error(msg);
		}
	}

	async function handleConfirmReceive() {
		try {
			await receiveMutation.mutateAsync({
				ticketId: ticket._id,
				shelterCode
			});

			toast.success(
				`ยืนยันรับสินค้าสำหรับใบเบิกจ่าย ${ticket.ticket_no} ถึงจุดแจกจ่ายเรียบร้อยแล้ว (สถานะ: กำลังแจกจ่าย)`
			);
			isReceiveConfirmOpen = false;
			onActionSuccess?.();
		} catch (err) {
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการยืนยันรับสินค้า กรุณาลองใหม่อีกครั้ง'
			);
			toast.error(msg);
		}
	}
</script>

<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5">
	<div class="flex items-center justify-between border-b border-slate-100 pb-3">
		<div>
			<h3 class="text-sm font-bold text-slate-900">การดำเนินการ</h3>
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
						<Button
							type="button"
							variant="outline"
							disabled={isAnyPending}
							onclick={() => (isAllocateOpen = true)}
							class="border-[#0A2647] text-xs font-semibold text-[#0A2647] hover:bg-[#0A2647]/5 hover:text-[#0A2647]"
						>
							<Boxes class="h-4 w-4" />
							<span>จัดสรรยอดสินค้า</span>
						</Button>
					{/if}

					<!-- Action 2: Approve for Dispatch -->
					{#if canApprove}
						<Button
							type="button"
							variant="default"
							disabled={!approvalReadiness.ready || isAnyPending}
							onclick={() => (isApproveConfirmOpen = true)}
							class="text-xs font-semibold hover:bg-primary-dark"
							title={approvalReadiness.ready ? 'อนุมัติให้ปล่อยของ' : approvalReadiness.reason}
						>
							{#if approveMutation.isPending}
								<Loader2 class="h-4 w-4 animate-spin" />
								<span>กำลังอนุมัติ...</span>
							{:else}
								<CheckCircle2 class="h-4 w-4" />
								<span>อนุมัติให้ปล่อยของ</span>
							{/if}
						</Button>
					{/if}

					<!-- Action 3: Cancel Ticket -->
					{#if canCancel}
						<Button
							type="button"
							variant="outline"
							disabled={isAnyPending}
							onclick={() => (isCancelOpen = true)}
							class="border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 hover:text-red-700"
						>
							<Ban class="h-4 w-4" />
							<span>ยกเลิกตั๋ว</span>
						</Button>
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
			<div class="space-y-4">
				<div class="flex flex-wrap items-center gap-3">
					{#if canDispatch}
						<Button
							type="button"
							variant="default"
							disabled={isAnyPending}
							onclick={() => (isDispatchOpen = true)}
							class="text-xs font-semibold hover:bg-primary-dark"
						>
							<Truck class="h-4 w-4" />
							<span>เลือก Physical Lot และปล่อยรถ</span>
						</Button>
					{/if}

					{#if canCancel}
						<Button
							type="button"
							variant="outline"
							disabled={isAnyPending}
							onclick={() => (isCancelOpen = true)}
							class="border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 hover:text-red-700"
						>
							<Ban class="h-4 w-4" />
							<span>ยกเลิกตั๋ว</span>
						</Button>
					{/if}
				</div>

				{#if !canDispatch}
					<div
						class="flex items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-900"
					>
						<Info class="h-4 w-4 shrink-0 text-sky-600" />
						<div>
							<strong>อนุมัติให้ปล่อยของแล้ว (พร้อมส่งออก)</strong>
							<p class="mt-0.5 text-slate-600">
								รอเจ้าหน้าที่คลังหรือผู้จัดการเลือก Physical Lot เพื่อปล่อยรถนำส่งไปยังจุดแจกจ่าย
							</p>
						</div>
					</div>
				{/if}
			</div>
		{:else if ticket.status === 'IN_TRANSIT'}
			<div class="space-y-4">
				<div class="flex flex-wrap items-center gap-3">
					{#if canReceive}
						<Button
							type="button"
							variant="default"
							disabled={isAnyPending}
							onclick={() => (isReceiveConfirmOpen = true)}
							class="bg-emerald-700 text-xs font-semibold hover:bg-emerald-800"
						>
							{#if receiveMutation.isPending}
								<Loader2 class="h-4 w-4 animate-spin" />
								<span>กำลังบันทึกการรับของ...</span>
							{:else}
								<PackageCheck class="h-4 w-4" />
								<span>ยืนยันรับของถึงจุดแจก</span>
							{/if}
						</Button>
					{/if}
				</div>

				<div
					class="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900"
				>
					<Info class="h-4 w-4 shrink-0 text-blue-600" />
					<div>
						<strong>กำลังนำส่ง</strong>
						<p class="mt-0.5 text-slate-600">
							สินค้าอยู่ระหว่างการเดินทางไปยัง <strong>{ticket.destination_location}</strong>
							{#if ticket.driver_name}
								(คนขับ: {ticket.driver_name}{ticket.license_plate
									? ` / ทะเบียน: ${ticket.license_plate}`
									: ''})
							{/if}
							(รอเจ้าหน้าที่จุดแจกยืนยันรับของ)
						</p>
					</div>
				</div>
			</div>
		{:else if ticket.status === 'DISTRIBUTING'}
			<div class="space-y-4">
				<div
					class="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900"
				>
					<Info class="h-4 w-4 shrink-0 text-emerald-600" />
					<div>
						<strong>เปิดแจกจ่ายแล้ว</strong>
						<p class="mt-0.5 text-slate-600">
							สินค้าพร้อมแจกจ่ายที่จุดบริการ <strong>{ticket.destination_location}</strong>
							การแจกจ่ายดำเนินการที่หน้าจุดแจกจ่ายหน้างาน (Onsite)
						</p>
					</div>
				</div>

				<div class="flex items-center gap-3">
					<Button
						href="/onsite"
						variant="outline"
						class="border-emerald-300 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 hover:text-emerald-800"
					>
						<span>ไปยังหน้าจุดแจกจ่าย (Onsite)</span>
						<ArrowRight class="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		{:else if ticket.status === 'SHIFT_CLOSED'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-purple-200 bg-purple-50/60 p-3 text-xs text-purple-900"
			>
				<Info class="h-4 w-4 shrink-0 text-purple-600" />
				<div>
					<strong>ปิดรอบแจกจ่ายแล้ว</strong>
					<p class="mt-0.5 text-slate-600">
						จุดแจกปิดรอบและกระทบยอดแล้ว อยู่ระหว่างรอส่งของเหลือคืนคลังสินค้า (ถ้ามี)
					</p>
				</div>
			</div>
		{:else if ticket.status === 'RETURN_PENDING_RECEIPT'}
			<div class="space-y-4">
				<div class="flex flex-wrap items-center gap-3">
					{#if canReceiveReturns}
						<Button
							type="button"
							variant="default"
							disabled={isAnyPending}
							onclick={() => (isWarehouseReturnOpen = true)}
							class="text-xs font-semibold hover:bg-primary-dark"
						>
							<PackageCheck class="h-4 w-4" />
							<span>ตรวจรับของคืนเข้าคลังสินค้า</span>
						</Button>
					{/if}
				</div>

				<div
					class="flex items-center gap-2.5 rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-xs text-orange-900"
				>
					<Info class="h-4 w-4 shrink-0 text-orange-600" />
					<div>
						<strong>รอคลังตรวจรับคืน</strong>
						<p class="mt-0.5 text-slate-600">
							ของเหลือถูกส่งกลับมาที่คลังแล้ว
							{#if canReceiveReturns}
								เจ้าหน้าที่คลังสามารถกดปุ่มตรวจรับเพื่อยืนยันจำนวนของจริงเข้าสต็อกคลัง
							{:else}
								รอเจ้าหน้าที่คลังตรวจนับและรับเข้าสต็อก
							{/if}
						</p>
					</div>
				</div>
			</div>
		{:else if ticket.status === 'RETURN_COMPLETED'}
			<div class="space-y-4">
				<div class="flex flex-wrap items-center gap-3">
					{#if canReceiveReturns}
						<Button
							type="button"
							variant="default"
							disabled={isAnyPending}
							onclick={() => (isCompleteConfirmOpen = true)}
							class="bg-teal-800 text-xs font-semibold hover:bg-teal-900"
						>
							<CheckCircle2 class="h-4 w-4" />
							<span>ปิดตั๋วใบเบิกจ่าย</span>
						</Button>
					{/if}
				</div>

				<div
					class="flex items-center gap-2.5 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900"
				>
					<Info class="h-4 w-4 shrink-0 text-teal-600" />
					<div>
						<strong>ตรวจรับคืนเรียบร้อยแล้ว</strong>
						<p class="mt-0.5 text-slate-600">
							คลังบันทึกยอดรับคืนเข้าคลังเรียบร้อยแล้ว
							{#if canReceiveReturns}
								สามารถดำเนินการปิดตั๋วเพื่อสิ้นสุดกระบวนการเบิกจ่าย
							{:else}
								รอเจ้าหน้าที่ที่ได้รับมอบหมายทำการปิดตั๋วอย่างสมบูรณ์
							{/if}
						</p>
					</div>
				</div>
			</div>
		{:else if ticket.status === 'COMPLETED'}
			<div
				class="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
			>
				<CheckCircle2 class="h-4 w-4 shrink-0 text-emerald-600" />
				<div>
					<strong>ตั๋วเสร็จสมบูรณ์แล้ว</strong>
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
					<strong>ตั๋วนี้ถูกยกเลิกแล้ว</strong>
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
				> ให้เปลี่ยนสถานะเป็น "พร้อมส่งออก" ใช่หรือไม่?
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
				<span class="text-slate-500">ผู้อนุมัติ:</span>
				<span class="font-mono text-slate-800">{authContext?.createdBy ?? '-'}</span>
			</div>
		</div>

		<Dialog.Footer class="flex items-center justify-end gap-2">
			<Button
				type="button"
				variant="outline"
				onclick={() => (isApproveConfirmOpen = false)}
				class="text-xs font-semibold"
			>
				ยกเลิก
			</Button>
			<Button
				type="button"
				variant="default"
				onclick={handleConfirmApprove}
				disabled={approveMutation.isPending}
				class="text-xs font-semibold hover:bg-primary-dark"
			>
				{#if approveMutation.isPending}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					<span>กำลังอนุมัติ...</span>
				{:else}
					<span>ยืนยันอนุมัติ</span>
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Dispatch Ticket Dialog (Slice 5.3) -->
<DispatchTicketDialog
	bind:open={isDispatchOpen}
	{ticket}
	{shelterCode}
	onSuccess={() => {
		onActionSuccess?.();
	}}
	onClose={() => {
		isDispatchOpen = false;
	}}
/>

<!-- Receive Cargo Confirmation Dialog (Slice 5.3) -->
<Dialog.Root bind:open={isReceiveConfirmOpen}>
	<Dialog.Content class="sm:max-w-[500px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
				<PackageCheck class="h-5 w-5 text-emerald-600" />
				<span>ยืนยันรับสินค้าถึงจุดแจกจ่าย</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-slate-500">
				ยืนยันว่าสินค้าถูกขนส่งมาถึงจุดแจกจ่ายและพร้อมเปิดแจกจ่ายผู้พักพิง (สถานะจะเปลี่ยนเป็น
				"กำลังแจกจ่าย")
			</Dialog.Description>
		</Dialog.Header>

		<div
			class="my-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-700"
		>
			<div class="flex justify-between">
				<span class="text-slate-500">เลขที่ตั๋ว:</span>
				<span class="font-mono font-bold text-slate-900">{ticket.ticket_no}</span>
			</div>
			<div class="flex justify-between">
				<span class="text-slate-500">จุดหมายปลายทาง:</span>
				<span class="font-semibold text-slate-800">{ticket.destination_location}</span>
			</div>
			<div class="flex justify-between">
				<span class="text-slate-500">จำนวนรายการ:</span>
				<span class="font-semibold text-slate-800">{ticket.items.length} รายการ</span>
			</div>
			{#if ticket.driver_name}
				<div class="flex justify-between">
					<span class="text-slate-500">คนขับ / ยานพาหนะ:</span>
					<span class="text-slate-800"
						>{ticket.driver_name} {ticket.license_plate ? `(${ticket.license_plate})` : ''}</span
					>
				</div>
			{/if}
			<div class="flex justify-between border-t border-slate-200/80 pt-2">
				<span class="text-slate-500">ผู้รับมอบสินค้า:</span>
				<span class="font-mono font-semibold text-slate-800">{authContext?.createdBy ?? '-'}</span>
			</div>
		</div>

		<Dialog.Footer class="flex items-center justify-end gap-2">
			<Button
				type="button"
				variant="outline"
				onclick={() => (isReceiveConfirmOpen = false)}
				class="text-xs font-semibold"
			>
				ยกเลิก
			</Button>
			<Button
				type="button"
				variant="default"
				onclick={handleConfirmReceive}
				disabled={receiveMutation.isPending}
				class="bg-emerald-700 text-xs font-semibold hover:bg-emerald-800"
			>
				{#if receiveMutation.isPending}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					<span>กำลังบันทึก...</span>
				{:else}
					<span>ยืนยันรับของ</span>
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Modal 4: Warehouse Return Verification Dialog -->
<WarehouseReturnDialog
	bind:open={isWarehouseReturnOpen}
	{ticket}
	{shelterCode}
	onSuccess={onActionSuccess}
	onClose={() => (isWarehouseReturnOpen = false)}
/>

<!-- Modal 5: Complete Ticket Confirmation Dialog -->
<Dialog.Root bind:open={isCompleteConfirmOpen}>
	<Dialog.Content class="sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
				<CheckCircle2 class="h-5 w-5 text-teal-700" />
				<span>ยืนยันการปิดตั๋วใบเบิกจ่าย</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-slate-500">
				ต้องการปิดตั๋วใบเบิกจ่าย <strong class="font-mono text-slate-800">{ticket.ticket_no}</strong
				>
				ให้เปลี่ยนสถานะเป็น "เสร็จสมบูรณ์" ใช่หรือไม่?
			</Dialog.Description>
		</Dialog.Header>

		<div
			class="my-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
		>
			<div class="flex justify-between">
				<span class="text-slate-500">เลขที่ตั๋ว:</span>
				<span class="font-mono font-bold text-slate-900">{ticket.ticket_no}</span>
			</div>
			<div class="flex justify-between">
				<span class="text-slate-500">จุดหมาย:</span>
				<span class="font-semibold text-slate-800">{ticket.destination_location}</span>
			</div>
			<div class="flex justify-between">
				<span class="text-slate-500">สถานะปัจจุบัน:</span>
				<span class="font-semibold text-teal-800">ตรวจรับคืนเรียบร้อย</span>
			</div>
			<div class="flex justify-between border-t border-slate-200/80 pt-2">
				<span class="text-slate-500">ผู้ดำเนินการ:</span>
				<span class="font-mono text-slate-800">{authContext?.createdBy ?? '-'}</span>
			</div>
		</div>

		<Dialog.Footer class="flex items-center justify-end gap-2">
			<Button
				type="button"
				variant="outline"
				onclick={() => (isCompleteConfirmOpen = false)}
				class="text-xs font-semibold"
			>
				ยกเลิก
			</Button>
			<Button
				type="button"
				variant="default"
				onclick={handleConfirmComplete}
				disabled={completeMutation.isPending}
				class="bg-teal-800 text-xs font-semibold hover:bg-teal-900"
			>
				{#if completeMutation.isPending}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					<span>กำลังปิดตั๋ว...</span>
				{:else}
					<span>ยืนยันปิดตั๋ว</span>
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
