<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import Info from '@lucide/svelte/icons/info';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Lock from '@lucide/svelte/icons/lock';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Send from '@lucide/svelte/icons/send';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Truck from '@lucide/svelte/icons/truck';
	import {
		resolveAuthenticatedAuthorContext,
		useCloseShift,
		useShiftReconciliation,
		useSubmitReturnsToWarehouse
	} from '../../application/queries';
	import { canPerformFrontlineDistribution } from '../../application/food-supplies/auth';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		buildCloseShiftOptions,
		computeShiftClosePreview,
		initializeReturnedQuantities,
		validateShiftCloseForm
	} from '../model/shift-reconciliation';
	import { formatDistributionError } from '../model/distribution-error';
	import {
		normalizeWholeItemInput,
		formatNormalizationNotice
	} from '../model/ticket-quantity';

	interface Props {
		ticket: RequisitionTicket | null;
		shelterCode: string;
		onShiftClosed?: (ticket: RequisitionTicket) => void;
		onReturnsSubmitted?: (ticket: RequisitionTicket) => void;
	}

	let { ticket, shelterCode, onShiftClosed, onReturnsSubmitted }: Props = $props();

	// Session authority
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(shelterCode);
		} catch {
			return null;
		}
	});

	const canFrontline = $derived(authContext ? canPerformFrontlineDistribution(authContext) : false);

	const ticketId = $derived(ticket?._id ?? '');
	const reconciliationQuery = useShiftReconciliation(
		() => ticketId,
		() => shelterCode,
		() => Boolean(ticketId)
	);

	const closeShiftMutation = useCloseShift();
	const submitReturnsMutation = useSubmitReturnsToWarehouse();

	// Form state for returned quantities, keyed by item_id
	let returnedInputs = $state<Record<string, string>>({});
	let reconcileNotices = $state<Record<string, string>>({});
	let initializedForTicketId = $state<string | null>(null);
	let submitError = $state<string | null>(null);

	function handleReturnedQtyBlur(itemId: string) {
		const raw = (returnedInputs[itemId] ?? '').trim();
		if (!raw) return;
		const normRes = normalizeWholeItemInput(raw, { allowZero: true });
		if (normRes.normalized !== null) {
			if (normRes.wasNormalized) {
				reconcileNotices[itemId] = formatNormalizationNotice(raw, normRes.normalized, 'ชิ้น');
			}
			returnedInputs[itemId] = normRes.normalized;
		}
	}

	// Sync initial form values when reconciliation data is loaded
	$effect(() => {
		const data = reconciliationQuery.data;
		if (data && ticket && ticket._id !== initializedForTicketId) {
			if (ticket.status === 'DISTRIBUTING') {
				returnedInputs = initializeReturnedQuantities(data.summaries);
				initializedForTicketId = ticket._id;
				submitError = null;
			}
		}
	});

	const summaries = $derived(reconciliationQuery.data?.summaries ?? []);
	const validation = $derived(validateShiftCloseForm(summaries, returnedInputs));
	const preview = $derived(computeShiftClosePreview(summaries, returnedInputs));

	async function handleCloseShift() {
		if (!canFrontline) {
			toast.error('คุณไม่มีสิทธิ์ในการปิดรอบแจกจ่าย');
			return;
		}
		if (!ticket) return;

		for (const item of summaries) {
			handleReturnedQtyBlur(item.item_id);
		}

		submitError = null;
		if (!validation.isValid || !validation.normalizedValues) {
			const firstError = Object.values(validation.errors)[0] ?? 'กรุณาตรวจสอบจำนวนส่งคืน';
			submitError = firstError;
			toast.error(firstError);
			return;
		}

		const options = buildCloseShiftOptions(validation.normalizedValues);

		try {
			const updatedTicket = await closeShiftMutation.mutateAsync({
				ticketId: ticket._id,
				options,
				shelterCode
			});

			if (updatedTicket.status === 'COMPLETED') {
				toast.success(
					`ปิดรอบแจกจ่ายเรียบร้อยแล้ว: ตั๋ว ${updatedTicket.ticket_no} เสร็จสิ้นสมบูรณ์ (COMPLETED)`
				);
			} else {
				toast.success(
					`ปิดรอบแจกจ่ายเรียบร้อยแล้ว: ตั๋ว ${updatedTicket.ticket_no} อยู่ในสถานะปิดรอบ (SHIFT_CLOSED)`
				);
			}

			onShiftClosed?.(updatedTicket);
		} catch (err) {
			// CRITICAL: Preserve form inputs so the operator does not lose their entries
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการปิดรอบแจกจ่าย กรุณาลองใหม่อีกครั้ง'
			);
			submitError = msg;
			toast.error(msg);
		}
	}

	async function handleSubmitReturns() {
		if (!canFrontline) {
			toast.error('คุณไม่มีสิทธิ์ในการส่งคืนพัสดุกลับคลัง');
			return;
		}
		if (!ticket) return;

		submitError = null;
		try {
			const updatedTicket = await submitReturnsMutation.mutateAsync({
				ticketId: ticket._id,
				shelterCode
			});

			toast.success(
				`ส่งคืนพัสดุสำหรับตั๋ว ${updatedTicket.ticket_no} เรียบร้อยแล้ว (รอคลังตรวจรับ)`
			);
			onReturnsSubmitted?.(updatedTicket);
		} catch (err) {
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการส่งคืนพัสดุกลับคลัง กรุณาลองใหม่อีกครั้ง'
			);
			submitError = msg;
			toast.error(msg);
		}
	}
</script>

<div class="space-y-6">
	{#if !ticket}
		<!-- No ticket selected -->
		<div class="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
			<Clock class="mx-auto mb-3 h-10 w-10 text-slate-300" />
			<h3 class="text-sm font-bold text-slate-800">ยังไม่ได้เลือกใบเบิกจ่าย</h3>
			<p class="mt-1 text-xs text-slate-500">
				กรุณาเลือกตั๋วที่กำลังแจกจ่ายเพื่อตรวจนับของเหลือและปิดรอบ
			</p>
		</div>
	{:else if reconciliationQuery.isLoading}
		<!-- Loading state -->
		<div class="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
			<RefreshCw class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-400" />
			<p class="text-sm font-semibold text-slate-800">กำลังดึงข้อมูลกระทบยอดรอบการแจกจ่าย...</p>
			<p class="mt-0.5 text-xs text-slate-500">ตั๋ว {ticket.ticket_no}</p>
		</div>
	{:else if reconciliationQuery.isError}
		<!-- Error state -->
		<div class="rounded-2xl border border-red-200 bg-red-50/60 p-8 text-center shadow-xs">
			<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" />
			<h3 class="text-sm font-bold text-red-900">ไม่สามารถโหลดข้อมูลกระทบยอดได้</h3>
			<p class="mt-1 text-xs text-red-700">
				{formatDistributionError(
					reconciliationQuery.error,
					'กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง'
				)}
			</p>
			<button
				type="button"
				onclick={() => reconciliationQuery.refetch()}
				class="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-2xs hover:bg-red-50"
			>
				<RefreshCw class="h-3.5 w-3.5" />
				<span>ลองใหม่</span>
			</button>
		</div>
	{:else}
		<!-- Authoritative Ticket Reconciliation Surface -->
		<div class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
			<!-- Header -->
			<div
				class="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-11 w-11 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 text-teal-700 shadow-2xs"
					>
						<Lock class="h-6 w-6" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-2xs font-bold tracking-wide text-teal-700 uppercase">
								ปิดรอบและส่งคืน · Shift Reconciliation
							</span>
							<span
								class="rounded-full px-2 py-0.5 font-mono text-2xs font-bold {ticket.status ===
								'DISTRIBUTING'
									? 'bg-emerald-100 text-emerald-800'
									: ticket.status === 'SHIFT_CLOSED'
										? 'bg-purple-100 text-purple-800'
										: ticket.status === 'RETURN_PENDING_RECEIPT'
											? 'bg-orange-100 text-orange-800'
											: 'bg-slate-100 text-slate-800'}"
							>
								{ticket.status}
							</span>
						</div>
						<h2 class="text-lg font-bold text-slate-900">
							ใบเบิก {ticket.ticket_no} ({ticket.requisition_type === 'food'
								? 'อาหารปรุงสำเร็จ'
								: 'พัสดุสิ่งของ'})
						</h2>
						<p class="text-xs text-slate-500">
							ปลายทาง: {ticket.destination_location} • ผู้เบิก: {ticket.requested_by}
						</p>
					</div>
				</div>

				<!-- Read-only role warning if user cannot close shift -->
				{#if !canFrontline}
					<div
						class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
					>
						<ShieldAlert class="h-4 w-4 text-amber-600" />
						<span>โหมดอ่านอย่างเดียว (ไม่มีสิทธิ์ปิดรอบ/ส่งคืน)</span>
					</div>
				{/if}
			</div>

			<!-- Error banner if mutation failed -->
			{#if submitError}
				<div class="rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs text-red-900">
					<div class="flex items-start gap-2">
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
						<div>
							<p class="font-bold">เกิดข้อผิดพลาด</p>
							<p class="mt-0.5 text-red-800">{submitError}</p>
							<p class="mt-1 text-2xs text-red-600">
								ข้อมูลที่กรอกไว้ถูกเก็บรักษา สามารถตรวจสอบแล้วกดลองใหม่ได้ทันที
							</p>
						</div>
					</div>
				</div>
			{/if}

			{#if ticket.status === 'DISTRIBUTING'}
				<!-- 1. ACTIVE EDITABLE SHIFT CLOSE FORM -->
				<div class="space-y-4">
					<div class="overflow-x-auto rounded-xl border border-slate-200/80">
						<table class="w-full min-w-[700px] text-left text-sm text-slate-700">
							<thead
								class="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th scope="col" class="py-3.5 pr-3 pl-4">สินค้า</th>
									<th scope="col" class="px-3 py-3.5 text-right">ยอดเบิกมา</th>
									<th scope="col" class="px-3 py-3.5 text-right">แจกจริงแล้ว</th>
									<th scope="col" class="px-3 py-3.5 text-right">ของเหลือในมือ</th>
									<th scope="col" class="w-48 px-3 py-3.5 text-right">ส่งคืนคลัง (ชิ้น)</th>
									<th scope="col" class="py-3.5 pr-4 pl-3 text-right">ส่วนต่าง / ของหาย</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each preview.itemPreviews as item (item.itemId)}
									<tr class="transition-colors hover:bg-slate-50/60">
										<td class="py-3.5 pr-3 pl-4">
											<div class="font-bold text-slate-900">{item.itemName}</div>
											<div class="font-mono text-2xs text-slate-400">{item.itemId}</div>
										</td>
										<td class="px-3 py-3.5 text-right font-mono tabular-nums">{item.allocated}</td>
										<td class="px-3 py-3.5 text-right font-mono text-emerald-700 tabular-nums">
											{item.distributed}
										</td>
										<td
											class="px-3 py-3.5 text-right font-mono font-bold text-slate-900 tabular-nums"
										>
											{item.remainingInHand}
										</td>
										<td class="px-3 py-3.5 text-right">
											<div class="flex flex-col items-end">
												<Input
													type="text"
													inputmode="decimal"
													disabled={!canFrontline || closeShiftMutation.isPending}
													value={returnedInputs[item.itemId] ?? ''}
													onblur={() => handleReturnedQtyBlur(item.itemId)}
													oninput={(e) => {
														delete reconcileNotices[item.itemId];
														returnedInputs[item.itemId] = (e.target as HTMLInputElement).value;
													}}
													aria-label={`จำนวนส่งคืน ${item.itemName}`}
													aria-invalid={!!validation.errors[item.itemId]}
													class="h-8 w-28 text-right text-xs font-bold tabular-nums {validation
														.errors[item.itemId]
														? 'border-red-300 bg-red-50 text-red-900 focus-visible:ring-red-500'
														: 'border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-600'}"
												/>
												{#if reconcileNotices[item.itemId]}
													<span class="mt-1 text-right text-2xs font-medium text-amber-700" role="status">
														{reconcileNotices[item.itemId]}
													</span>
												{/if}
												{#if validation.errors[item.itemId]}
													<span class="mt-1 text-right text-2xs text-red-600">
														{validation.errors[item.itemId]}
													</span>
												{/if}
											</div>
										</td>
										<td class="py-3.5 pr-4 pl-3 text-right font-mono tabular-nums">
											{#if item.hasDiscrepancy}
												<span
													class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-bold text-amber-900"
												>
													<AlertCircle class="h-3 w-3 text-amber-600" />
													ขาด {item.discrepancy}
												</span>
											{:else}
												<span class="text-xs text-slate-400">ครบพอดี (0)</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot
								class="border-t border-slate-200 bg-slate-50/50 text-xs font-bold text-slate-800"
							>
								<tr>
									<td class="py-3 pr-3 pl-4">รวมทั้งหมด</td>
									<td class="px-3 py-3 text-right font-mono tabular-nums">
										{preview.totalAllocated}
									</td>
									<td class="px-3 py-3 text-right font-mono text-emerald-700 tabular-nums">
										{preview.totalDistributed}
									</td>
									<td class="px-3 py-3 text-right font-mono tabular-nums">
										{preview.totalRemainingInHand}
									</td>
									<td class="px-3 py-3 text-right font-mono text-teal-800 tabular-nums">
										{preview.totalReturned}
									</td>
									<td class="py-3 pr-4 pl-3 text-right font-mono tabular-nums">
										{#if preview.hasDiscrepancy}
											<span class="text-amber-800">ขาด {preview.totalDiscrepancy}</span>
										{:else}
											<span class="text-emerald-700">0</span>
										{/if}
									</td>
								</tr>
							</tfoot>
						</table>
					</div>

					<!-- Lifecycle Preview Banners -->
					{#if preview.isZeroReturnFastPath}
						<!-- Zero-Return Fast Path Notice -->
						<div
							class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-950"
						>
							<div class="flex items-start gap-2.5">
								<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
								<div>
									<p class="font-bold">เส้นทางปิดตั๋วทันที (Zero Physical Returns Fast Path)</p>
									<p class="mt-0.5 text-slate-600">
										ยอดส่งคืนคลังรวมเป็น 0 ชิ้น ระบบจะปิดรอบและเปลี่ยนสถานะตั๋วเป็น <strong
											class="text-emerald-800">เสร็จสิ้นสมบูรณ์ (COMPLETED)</strong
										> ทันที โดยไม่ต้องส่งรถกลับคลังกลาง
									</p>
								</div>
							</div>
						</div>
					{:else}
						<!-- Physical Returns Required Notice -->
						<div class="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-950">
							<div class="flex items-start gap-2.5">
								<Truck class="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
								<div>
									<p class="font-bold">
										มีพัสดุส่งคืนคลัง ({preview.totalReturned} ชิ้น)
									</p>
									<p class="mt-0.5 text-slate-600">
										การปิดรอบจะเปลี่ยนสถานะตั๋วเป็น <strong class="text-purple-800"
											>ปิดรอบแล้ว (SHIFT_CLOSED)</strong
										>
										จากนั้นเจ้าหน้าที่จะสามารถกดยืนยันส่งคืนพัสดุกลับคลังกลาง (RETURN_PENDING_RECEIPT)
										ในขั้นตอนถัดไป (ยอดสต็อกคลังยังไม่ถูกเพิ่มจนกว่าคลังจะตรวจรับจริง)
									</p>
								</div>
							</div>
						</div>
					{/if}

					<!-- Discrepancy Warning Notice if applicable -->
					{#if preview.hasDiscrepancy}
						<div
							class="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950"
						>
							<div class="flex items-start gap-2.5">
								<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
								<div>
									<p class="font-bold">
										พบส่วนต่าง / ของหาย ({preview.totalDiscrepancy} ชิ้น)
									</p>
									<p class="mt-0.5 text-amber-800">
										ยอดเบิกมา ({preview.totalAllocated}) มากกว่ายอดแจกจริงรวมกับยอดส่งคืน ({preview.totalDistributed}
										+ {preview.totalReturned}) ส่วนต่างนี้จะถูกบันทึกในเอกสารตั๋ว
									</p>
								</div>
							</div>
						</div>
					{/if}

					<!-- Close Shift Action Button -->
					<div class="flex items-center justify-end pt-2">
						<button
							type="button"
							onclick={handleCloseShift}
							disabled={!canFrontline || !validation.isValid || closeShiftMutation.isPending}
							class="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#if closeShiftMutation.isPending}
								<Loader2 class="h-4 w-4 animate-spin" />
								<span>กำลังบันทึกปิดรอบแจกจ่าย...</span>
							{:else}
								<Lock class="h-4 w-4" />
								<span>ยืนยันปิดรอบแจกจ่าย (Close Shift)</span>
							{/if}
						</button>
					</div>
				</div>
			{:else if ticket.status === 'SHIFT_CLOSED'}
				<!-- 2. SHIFT CLOSED STATE — ACTION: SUBMIT RETURNS TO WAREHOUSE -->
				<div class="space-y-4">
					<div
						class="rounded-xl border border-purple-200 bg-purple-50/60 p-4 text-xs text-purple-950"
					>
						<div class="flex items-start gap-2.5">
							<Info class="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
							<div>
								<p class="font-bold">ปิดรอบแจกจ่ายเรียบร้อยแล้ว (Shift Closed)</p>
								<p class="mt-0.5 text-slate-600">
									รอบการแจกจ่ายนี้ปิดยอดแล้ว กรุณากดยืนยันส่งคืนพัสดุที่เหลือกลับคลังกลาง
									เพื่อให้คลังสามารถดำเนินการตรวจรับของจริงเข้าสู่ระบบ
								</p>
							</div>
						</div>
					</div>

					<!-- Summary Table of Closed Shift -->
					<div class="overflow-x-auto rounded-xl border border-slate-200/80">
						<table class="w-full min-w-[640px] text-left text-sm text-slate-700">
							<thead
								class="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th scope="col" class="py-3 pr-3 pl-4">สินค้า</th>
									<th scope="col" class="px-3 py-3 text-right">ยอดเบิก</th>
									<th scope="col" class="px-3 py-3 text-right">แจกแล้ว</th>
									<th scope="col" class="px-3 py-3 text-right text-purple-800">ยอดรอส่งคืน</th>
									<th scope="col" class="py-3 pr-4 pl-3 text-right">ส่วนต่าง</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each ticket.items as item (item.item_id)}
									<tr>
										<td class="py-3 pr-3 pl-4 font-semibold text-slate-900">{item.item_name}</td>
										<td class="px-3 py-3 text-right font-mono tabular-nums">{item.allocated_qty}</td
										>
										<td class="px-3 py-3 text-right font-mono tabular-nums"
											>{item.distributed_qty ?? '0'}</td
										>
										<td
											class="px-3 py-3 text-right font-mono font-bold text-purple-800 tabular-nums"
										>
											{item.returned_qty ?? '0'}
										</td>
										<td class="py-3 pr-4 pl-3 text-right font-mono tabular-nums">
											{item.discrepancy_qty ?? '0'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- Submit Action -->
					<div class="flex items-center justify-end pt-2">
						<button
							type="button"
							onclick={handleSubmitReturns}
							disabled={!canFrontline || submitReturnsMutation.isPending}
							class="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#if submitReturnsMutation.isPending}
								<Loader2 class="h-4 w-4 animate-spin" />
								<span>กำลังส่งข้อมูลคืนคลัง...</span>
							{:else}
								<Send class="h-4 w-4" />
								<span>ส่งคืนพัสดุกลับคลังกลาง (Submit Returns to Warehouse)</span>
							{/if}
						</button>
					</div>
				</div>
			{:else if ticket.status === 'RETURN_PENDING_RECEIPT'}
				<!-- 3. WAITING FOR WAREHOUSE RECEIPT -->
				<div class="space-y-4">
					<div
						class="rounded-xl border border-orange-200 bg-orange-50/70 p-4 text-xs text-orange-950"
					>
						<div class="flex items-start gap-2.5">
							<Truck class="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
							<div>
								<p class="font-bold">
									ส่งคืนของแล้ว • รอคลังสินค้าตรวจรับ (Return Pending Receipt)
								</p>
								<p class="mt-0.5 text-slate-600">
									ของเหลือถูกส่งกลับไปยังคลังแล้ว อยู่ระหว่างรอเจ้าหน้าที่คลังตรวจสอบของจริงที่
									Dockside และยืนยันรับเข้าสต็อก
								</p>
							</div>
						</div>
					</div>

					<div class="overflow-x-auto rounded-xl border border-slate-200/80">
						<table class="w-full min-w-[640px] text-left text-sm text-slate-700">
							<thead
								class="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th scope="col" class="py-3 pr-3 pl-4">สินค้า</th>
									<th scope="col" class="px-3 py-3 text-right">ยอดเบิก</th>
									<th scope="col" class="px-3 py-3 text-right">แจกจริง</th>
									<th scope="col" class="px-3 py-3 text-right font-bold text-orange-800">
										ยอดส่งคืนคลัง
									</th>
									<th scope="col" class="py-3 pr-4 pl-3 text-right">ส่วนต่าง</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each ticket.items as item (item.item_id)}
									<tr>
										<td class="py-3 pr-3 pl-4 font-semibold text-slate-900">{item.item_name}</td>
										<td class="px-3 py-3 text-right font-mono tabular-nums">{item.allocated_qty}</td
										>
										<td class="px-3 py-3 text-right font-mono tabular-nums"
											>{item.distributed_qty ?? '0'}</td
										>
										<td
											class="px-3 py-3 text-right font-mono font-bold text-orange-800 tabular-nums"
										>
											{item.returned_qty ?? '0'}
										</td>
										<td class="py-3 pr-4 pl-3 text-right font-mono tabular-nums">
											{item.discrepancy_qty ?? '0'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{:else if ticket.status === 'RETURN_COMPLETED'}
				<!-- 4. RETURN COMPLETED (Dockside received) -->
				<div class="space-y-4">
					<div class="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-xs text-teal-950">
						<div class="flex items-start gap-2.5">
							<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
							<div>
								<p class="font-bold">คลังสินค้าตรวจรับของคืนเรียบร้อยแล้ว (Return Completed)</p>
								<p class="mt-0.5 text-slate-600">
									คลังได้รับของและเพิ่มสต็อกเข้าคลังแล้ว รอปิดตั๋วโดยผู้จัดการคลัง
								</p>
							</div>
						</div>
					</div>
				</div>
			{:else if ticket.status === 'COMPLETED'}
				<!-- 5. TICKET COMPLETED (Terminal) -->
				<div class="space-y-4">
					<div
						class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-950"
					>
						<div class="flex items-start gap-2.5">
							<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
							<div>
								<p class="font-bold">ใบเบิกจ่ายนี้เสร็จสิ้นสมบูรณ์แล้ว (Completed)</p>
								<p class="mt-0.5 text-slate-600">
									การแจกจ่าย การกระทบยอด และการคืนของเสร็จสิ้นสมบูรณ์
								</p>
							</div>
						</div>
					</div>

					<div class="overflow-x-auto rounded-xl border border-slate-200/80">
						<table class="w-full min-w-[640px] text-left text-sm text-slate-700">
							<thead
								class="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th scope="col" class="py-3 pr-3 pl-4">สินค้า</th>
									<th scope="col" class="px-3 py-3 text-right">ยอดเบิก</th>
									<th scope="col" class="px-3 py-3 text-right">แจกจริง</th>
									<th scope="col" class="px-3 py-3 text-right">คืนคลัง</th>
									<th scope="col" class="py-3 pr-4 pl-3 text-right">ส่วนต่าง</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each ticket.items as item (item.item_id)}
									<tr>
										<td class="py-3 pr-3 pl-4 font-semibold text-slate-900">{item.item_name}</td>
										<td class="px-3 py-3 text-right font-mono tabular-nums">{item.allocated_qty}</td
										>
										<td class="px-3 py-3 text-right font-mono tabular-nums"
											>{item.distributed_qty ?? '0'}</td
										>
										<td class="px-3 py-3 text-right font-mono tabular-nums"
											>{item.returned_qty ?? '0'}</td
										>
										<td class="py-3 pr-4 pl-3 text-right font-mono tabular-nums">
											{item.discrepancy_qty ?? '0'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{:else}
				<!-- Unsupported Status for Frontline Reconciliation -->
				<div class="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs">
					<Info class="mx-auto mb-2 h-6 w-6 text-slate-400" />
					<p class="font-bold text-slate-800">ตั๋วอยู่ในสถานะ {ticket.status}</p>
					<p class="mt-1 text-slate-500">
						การปิดรอบและกระทบยอดสามารถดำเนินการได้เมื่อตั๋วอยู่ในสถานะกำลังแจกจ่าย (DISTRIBUTING)
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
