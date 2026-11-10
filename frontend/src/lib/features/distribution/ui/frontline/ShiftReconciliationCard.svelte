<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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
		useSubmitReturnsToWarehouse,
		useDistributionLogs
	} from '../../application/queries';
	import { canPerformFrontlineDistribution } from '../../application/food-supplies/auth';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		buildCloseShiftOptions,
		computeShiftClosePreview,
		formatTotalWithUnit,
		initializeReturnedQuantities,
		validateReturnedQuantity,
		validateShiftCloseForm
	} from '../model/shift-reconciliation';
	import { formatDistributionError } from '../model/distribution-error';
	import { isReturnedQtyDraft, type DeskDrafts } from '../model/desk-draft';
	import { getTicketStatusLabel } from '../model/ticket-status';
	import { summarizeTicketLoans } from '../model/loan-return';
	import { qtyGt } from '$lib/utils/qty';
	import TicketLoanSummary from '../common/TicketLoanSummary.svelte';
	import ShiftCloseStepGuide from '../common/ShiftCloseStepGuide.svelte';
	import TicketStatusBadge from '../common/TicketStatusBadge.svelte';
	import TicketCardHeader from '../common/TicketCardHeader.svelte';
	import Undo2 from '@lucide/svelte/icons/undo-2';

	interface Props {
		ticket: RequisitionTicket | null;
		shelterCode: string;
		/** Unit label of an item's base unit; '' while the catalog is loading. */
		unitOf: (itemId: string) => string;
		onShiftClosed?: (ticket: RequisitionTicket) => void;
		onReturnsSubmitted?: (ticket: RequisitionTicket) => void;
		/** FR-DFS-05 — the page asks before a mode switch drops edited returned quantities. */
		drafts?: DeskDrafts;
	}

	let { ticket, shelterCode, unitOf, onShiftClosed, onReturnsSubmitted, drafts }: Props = $props();

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
	let initializedForTicketId = $state<string | null>(null);
	// The prefilled values, kept so a refetch cannot make an untouched form look edited.
	let initialReturned: Record<string, string> = {};
	let submitError = $state<string | null>(null);

	function handleReturnedQtyBlur(itemId: string) {
		const item = reconciliationQuery.data?.summaries.find(
			(candidate) => candidate.item_id === itemId
		);
		if (!item) return;
		validateReturnedQuantity(returnedInputs[itemId] ?? '', item.remaining_in_hand);
	}

	// Sync initial form values when reconciliation data is loaded
	$effect(() => {
		const data = reconciliationQuery.data;
		if (data && ticket && ticket._id !== initializedForTicketId) {
			if (ticket.status === 'DISTRIBUTING') {
				returnedInputs = initializeReturnedQuantities(data.summaries);
				initialReturned = { ...returnedInputs };
				initializedForTicketId = ticket._id;
				submitError = null;
			}
		}
	});

	const summaries = $derived(reconciliationQuery.data?.summaries ?? []);

	$effect(() =>
		drafts?.track(
			() => ticket?.status === 'DISTRIBUTING' && isReturnedQtyDraft(initialReturned, returnedInputs)
		)
	);

	const itemIds = $derived(ticket?.items.map((i) => i.item_id) ?? []);
	const total = (qty: string) => formatTotalWithUnit(qty, itemIds, unitOf);

	const validation = $derived(validateShiftCloseForm(summaries, returnedInputs));
	const preview = $derived(computeShiftClosePreview(summaries, returnedInputs));

	// Durable-loan outstanding indicator — independent of ticket.status (see summarizeTicketLoans).
	const loanLogsQuery = useDistributionLogs(
		() => (ticket ? { ticket_id: ticket._id, is_returnable: true } : undefined),
		() => shelterCode,
		() => Boolean(ticket)
	);
	const loanSummary = $derived(
		ticket ? summarizeTicketLoans(ticket._id, loanLogsQuery.data ?? []) : null
	);
	const hasOutstandingLoans = $derived(
		Boolean(loanSummary && qtyGt(loanSummary.outstandingQty, '0'))
	);

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
				toast.success(`ปิดรอบแจกจ่ายเรียบร้อยแล้ว: ตั๋ว ${updatedTicket.ticket_no} เสร็จสมบูรณ์`);
			} else {
				toast.success(
					`ปิดรอบแจกจ่ายเรียบร้อยแล้ว: ตั๋ว ${updatedTicket.ticket_no} อยู่ในสถานะปิดรอบแล้ว`
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
			<Button
				type="button"
				variant="outline"
				onclick={() => reconciliationQuery.refetch()}
				class="mt-4 h-auto rounded-lg border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 hover:text-red-800"
			>
				<RefreshCw class="h-3.5 w-3.5" />
				<span>ลองใหม่</span>
			</Button>
		</div>
	{:else}
		<!-- Authoritative Ticket Reconciliation Surface -->
		<section
			class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-6"
			aria-label={`ปิดรอบ เลขตั๋ว ${ticket.ticket_no}`}
		>
			<!-- Header: what the ticket is, in the same words as the receive tab (#1183) -->
			<div
				class="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between"
			>
				<TicketCardHeader {ticket}>
					{#snippet badges()}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-900"
						>
							<Lock class="size-3.5" aria-hidden="true" />
							ปิดรอบและส่งคืน
						</span>
						<TicketStatusBadge status={ticket.status} />
						{#if hasOutstandingLoans && loanSummary}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
							>
								<Undo2 class="size-3.5" aria-hidden="true" />
								ของยืมค้างคืน {loanSummary.outstandingQty}
							</span>
						{/if}
					{/snippet}
				</TicketCardHeader>

				<!-- Read-only role warning if user cannot close shift -->
				{#if !canFrontline}
					<div
						class="inline-flex items-center gap-1.5 self-start rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900"
					>
						<ShieldAlert class="size-4 text-amber-600" aria-hidden="true" />
						<span>โหมดอ่านอย่างเดียว (ไม่มีสิทธิ์ปิดรอบ/ส่งคืน)</span>
					</div>
				{/if}
			</div>

			<!-- Error banner if mutation failed -->
			{#if submitError}
				<div
					class="rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-sm text-red-900"
					role="alert"
				>
					<div class="flex items-start gap-2">
						<AlertCircle class="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
						<div>
							<p class="font-bold">เกิดข้อผิดพลาด</p>
							<p class="mt-0.5 text-red-800">{submitError}</p>
							<p class="mt-1 text-xs text-red-700">
								ข้อมูลที่กรอกไว้ถูกเก็บรักษา สามารถตรวจสอบแล้วกดลองใหม่ได้ทันที
							</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Where this ticket is in the close-out sequence and what to do now -->
			<ShiftCloseStepGuide status={ticket.status} />

			{#if ticket.status === 'DISTRIBUTING'}
				<!-- 1. ACTIVE EDITABLE SHIFT CLOSE FORM -->
				<div class="space-y-4">
					<!-- Phone: one card per item -->
					<ul class="space-y-3 md:hidden">
						{#each preview.itemPreviews as item (item.itemId)}
							{@const unit = unitOf(item.itemId)}
							<li class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4">
								<p class="text-base font-bold break-words text-slate-900">{item.itemName}</p>
								<dl class="grid grid-cols-3 gap-2 text-center">
									<div class="rounded-lg bg-slate-50 p-2">
										<dt class="text-xs text-slate-500">เบิกมา</dt>
										<dd class="text-base font-semibold text-slate-900 tabular-nums">
											{item.allocated}
										</dd>
									</div>
									<div class="rounded-lg bg-slate-50 p-2">
										<dt class="text-xs text-slate-500">แจกแล้ว</dt>
										<dd class="text-base font-semibold text-emerald-800 tabular-nums">
											{item.distributed}
										</dd>
									</div>
									<div class="rounded-lg bg-slate-50 p-2">
										<dt class="text-xs text-slate-500">เหลือในมือ</dt>
										<dd class="text-base font-bold text-slate-900 tabular-nums">
											{item.remainingInHand}
										</dd>
									</div>
								</dl>
								{@render returnedInput(item, `returned-m-${item.itemId}`, 'h-12 w-full text-lg')}
								{@render discrepancyBadge(item, unit)}
							</li>
						{/each}
					</ul>

					<!-- Tablet and up: table -->
					<div class="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
						<table class="w-full text-left text-sm text-slate-700">
							<thead
								class="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th scope="col" class="py-3.5 pr-3 pl-4">สินค้า</th>
									<th scope="col" class="px-3 py-3.5 text-right">ยอดเบิกมา</th>
									<th scope="col" class="px-3 py-3.5 text-right">แจกจริงแล้ว</th>
									<th scope="col" class="px-3 py-3.5 text-right">ของเหลือในมือ</th>
									<th scope="col" class="w-44 px-3 py-3.5 text-right">ส่งคืนคลัง</th>
									<th scope="col" class="py-3.5 pr-4 pl-3 text-right">ส่วนต่าง / ของหาย</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each preview.itemPreviews as item (item.itemId)}
									{@const unit = unitOf(item.itemId)}
									<tr class="transition-colors hover:bg-slate-50/60">
										<td class="py-3.5 pr-3 pl-4 font-bold text-slate-900">{item.itemName}</td>
										<td class="px-3 py-3.5 text-right tabular-nums">
											{item.allocated} <span class="text-xs text-slate-500">{unit}</span>
										</td>
										<td class="px-3 py-3.5 text-right text-emerald-800 tabular-nums">
											{item.distributed} <span class="text-xs text-slate-500">{unit}</span>
										</td>
										<td class="px-3 py-3.5 text-right font-bold text-slate-900 tabular-nums">
											{item.remainingInHand}
											<span class="text-xs font-normal text-slate-500">{unit}</span>
										</td>
										<td class="px-3 py-3.5 text-right">
											{@render returnedInput(
												item,
												`returned-t-${item.itemId}`,
												'h-11 w-28 text-base'
											)}
										</td>
										<td class="py-3.5 pr-4 pl-3 text-right">
											{@render discrepancyBadge(item, unit)}
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot
								class="border-t border-slate-200 bg-slate-50/50 text-sm font-bold text-slate-800"
							>
								<tr>
									<td class="py-3 pr-3 pl-4">รวมทั้งหมด</td>
									<td class="px-3 py-3 text-right tabular-nums">{total(preview.totalAllocated)}</td>
									<td class="px-3 py-3 text-right text-emerald-800 tabular-nums">
										{total(preview.totalDistributed)}
									</td>
									<td class="px-3 py-3 text-right tabular-nums">
										{total(preview.totalRemainingInHand)}
									</td>
									<td class="px-3 py-3 text-right text-teal-800 tabular-nums">
										{total(preview.totalReturned)}
									</td>
									<td class="py-3 pr-4 pl-3 text-right tabular-nums">
										{#if preview.hasDiscrepancy}
											<span class="text-red-800">ขาด {total(preview.totalDiscrepancy)}</span>
										{:else}
											<span class="text-emerald-800">ครบ</span>
										{/if}
									</td>
								</tr>
							</tfoot>
						</table>
					</div>

					<!-- Lifecycle Preview Banners -->
					{#if preview.isZeroReturnFastPath}
						<div
							class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950"
						>
							<div class="flex items-start gap-2.5">
								<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
								<div>
									<p class="font-bold">ไม่มีของเหลือจากรอบแจกที่ต้องส่งคืนคลัง</p>
									{#if hasOutstandingLoans}
										<p class="mt-0.5 text-slate-700">
											สามารถปิดรอบแจกจ่ายได้ทันที แต่ยังมีของยืมที่ผู้ประสบภัยยังไม่ได้คืน
											ระบบจะติดตามต่อในรายการของยืม-คืนด้านล่าง
										</p>
									{:else}
										<p class="mt-0.5 text-slate-700">
											ระบบจะปิดรอบและเปลี่ยนสถานะตั๋วเป็น <strong class="text-emerald-800"
												>เสร็จสมบูรณ์</strong
											> ทันที โดยไม่ต้องส่งรถกลับคลังกลาง
										</p>
									{/if}
								</div>
							</div>
						</div>
					{:else}
						<div class="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-sky-950">
							<div class="flex items-start gap-2.5">
								<Truck class="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden="true" />
								<div>
									<p class="font-bold">มีของส่งคืนคลัง {total(preview.totalReturned)}</p>
									<p class="mt-0.5 text-slate-700">
										ปิดรอบแล้วตั๋วจะเป็น <strong class="text-purple-800">ปิดรอบแล้ว</strong>
										จากนั้นกดยืนยันส่งคืนของกลับคลังกลางในขั้นถัดไป (สต็อกคลังจะเพิ่มเมื่อคลังตรวจรับจริง)
									</p>
								</div>
							</div>
						</div>
					{/if}

					{#if preview.hasDiscrepancy}
						<div class="rounded-xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-950">
							<div class="flex items-start gap-2.5">
								<AlertCircle class="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
								<div>
									<p class="font-bold">ของขาด {total(preview.totalDiscrepancy)}</p>
									<p class="mt-0.5 text-red-900">
										ยอดเบิกมา ({preview.totalAllocated}) มากกว่ายอดแจกจริงรวมกับยอดส่งคืน ({preview.totalDistributed}
										+ {preview.totalReturned}) ส่วนต่างนี้จะถูกบันทึกในเอกสารตั๋ว
									</p>
								</div>
							</div>
						</div>
					{/if}

					<div class="flex justify-end pt-2">
						<Button
							type="button"
							variant="default"
							onclick={handleCloseShift}
							disabled={!canFrontline || !validation.isValid || closeShiftMutation.isPending}
							class="h-12 w-full rounded-lg bg-teal-700 px-5 text-base font-bold text-white hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:w-auto"
						>
							{#if closeShiftMutation.isPending}
								<Loader2 class="size-4 animate-spin" aria-hidden="true" />
								<span>กำลังบันทึกปิดรอบแจกจ่าย...</span>
							{:else}
								<Lock class="size-4" aria-hidden="true" />
								<span>ยืนยันปิดรอบแจกจ่าย</span>
							{/if}
						</Button>
					</div>
				</div>
			{:else if ticket.status === 'SHIFT_CLOSED'}
				<div class="space-y-4">
					<div
						class="rounded-xl border border-purple-200 bg-purple-50/60 p-4 text-sm text-purple-950"
					>
						<div class="flex items-start gap-2.5">
							<Info class="mt-0.5 size-4 shrink-0 text-purple-600" aria-hidden="true" />
							<div>
								<p class="font-bold">ปิดรอบแจกจ่ายเรียบร้อยแล้ว</p>
								<p class="mt-0.5 text-slate-700">
									กดยืนยันส่งคืนของที่เหลือกลับคลังกลาง เพื่อให้คลังตรวจรับของจริงเข้าระบบ
								</p>
							</div>
						</div>
					</div>

					{@render closedSummary('ยอดรอส่งคืน')}

					<div class="flex justify-end pt-2">
						<Button
							type="button"
							variant="default"
							onclick={handleSubmitReturns}
							disabled={!canFrontline || submitReturnsMutation.isPending}
							class="h-12 w-full rounded-lg bg-purple-700 px-5 text-base font-bold text-white hover:bg-purple-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:w-auto"
						>
							{#if submitReturnsMutation.isPending}
								<Loader2 class="size-4 animate-spin" aria-hidden="true" />
								<span>กำลังส่งข้อมูลคืนคลัง...</span>
							{:else}
								<Send class="size-4" aria-hidden="true" />
								<span>ส่งคืนพัสดุกลับคลังกลาง</span>
							{/if}
						</Button>
					</div>
				</div>
			{:else if ticket.status === 'RETURN_PENDING_RECEIPT'}
				<div class="space-y-4">
					<div class="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
						<div class="flex items-start gap-2.5">
							<Truck class="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
							<div>
								<p class="font-bold">ส่งคืนของแล้ว รอคลังตรวจรับ</p>
								<p class="mt-0.5 text-slate-700">
									ของเหลือถูกส่งกลับคลังแล้ว รอเจ้าหน้าที่คลังตรวจของจริงและยืนยันรับเข้าสต็อก
								</p>
							</div>
						</div>
					</div>
					{@render closedSummary('ยอดส่งคืนคลัง')}
				</div>
			{:else if ticket.status === 'RETURN_COMPLETED'}
				<div class="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-sm text-teal-950">
					<div class="flex items-start gap-2.5">
						<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-teal-600" aria-hidden="true" />
						<div>
							<p class="font-bold">คลังสินค้าตรวจรับของคืนเรียบร้อยแล้ว</p>
							<p class="mt-0.5 text-slate-700">
								คลังได้รับของและเพิ่มสต็อกแล้ว รอปิดตั๋วโดยผู้จัดการคลัง
							</p>
						</div>
					</div>
				</div>
			{:else if ticket.status === 'COMPLETED'}
				<div class="space-y-4">
					<div
						class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950"
					>
						<div class="flex items-start gap-2.5">
							<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
							<div>
								<p class="font-bold">ใบเบิกจ่ายนี้เสร็จสิ้นสมบูรณ์แล้ว</p>
								<p class="mt-0.5 text-slate-700">
									การแจกจ่าย การกระทบยอด และการคืนของเสร็จสิ้นสมบูรณ์
								</p>
							</div>
						</div>
					</div>
					{@render closedSummary('คืนคลัง')}
				</div>
			{:else}
				<div class="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm">
					<Info class="mx-auto mb-2 size-6 text-slate-400" aria-hidden="true" />
					<p class="font-bold text-slate-800">
						ตั๋วอยู่ในสถานะ {getTicketStatusLabel(ticket.status)}
					</p>
					<p class="mt-1 text-slate-600">
						การปิดรอบและกระทบยอดสามารถดำเนินการได้เมื่อตั๋วอยู่ในสถานะกำลังแจกจ่ายเท่านั้น
					</p>
				</div>
			{/if}

			<!-- Durable Loan Status (tracked independently of ticket lifecycle) -->
			<TicketLoanSummary ticketId={ticket._id} items={ticket.items} {shelterCode} />
		</section>
	{/if}
</div>

{#snippet returnedInput(
	item: (typeof preview.itemPreviews)[number],
	inputId: string,
	sizeClass: string
)}
	{@const error = validation.errors[item.itemId]}
	<div class="flex flex-col items-stretch gap-1 md:items-end">
		<Label for={inputId} class="text-sm font-semibold text-slate-700 md:sr-only">
			จำนวนส่งคืน<span class="sr-only"> {item.itemName}</span>
			{#if unitOf(item.itemId)}({unitOf(item.itemId)}){/if}
		</Label>
		<Input
			id={inputId}
			type="text"
			inputmode="numeric"
			disabled={!canFrontline || closeShiftMutation.isPending}
			value={returnedInputs[item.itemId] ?? ''}
			onblur={() => handleReturnedQtyBlur(item.itemId)}
			oninput={(e) => {
				returnedInputs[item.itemId] = (e.target as HTMLInputElement).value;
			}}
			aria-invalid={!!error}
			class="{sizeClass} text-right font-bold tabular-nums {error
				? 'border-red-300 bg-red-50 text-red-900 focus-visible:ring-red-500'
				: 'border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-600'}"
		/>
		{#if error}
			<span class="text-sm text-red-700">{error}</span>
		{/if}
	</div>
{/snippet}

{#snippet discrepancyBadge(item: (typeof preview.itemPreviews)[number], unit: string)}
	{#if item.hasDiscrepancy}
		<span
			class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900 tabular-nums"
		>
			<AlertCircle class="size-3.5 text-red-600" aria-hidden="true" />
			ขาด {item.discrepancy}
			{unit}
		</span>
	{:else}
		<span
			class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
		>
			<CheckCircle2 class="size-3.5 text-emerald-600" aria-hidden="true" />
			ครบ
		</span>
	{/if}
{/snippet}

{#snippet closedSummary(returnedLabel: string)}
	{#if ticket}
		<!-- Phone: one card per item -->
		<ul class="space-y-3 md:hidden">
			{#each ticket.items as item (item.item_id)}
				{@const unit = unitOf(item.item_id)}
				<li class="rounded-xl border border-slate-200/80 bg-white p-4">
					<p class="mb-2 text-base font-bold break-words text-slate-900">{item.item_name}</p>
					<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
						<dt class="text-slate-500">ยอดเบิก</dt>
						<dd class="text-right tabular-nums">{item.allocated_qty} {unit}</dd>
						<dt class="text-slate-500">แจกแล้ว</dt>
						<dd class="text-right tabular-nums">{item.distributed_qty ?? '0'} {unit}</dd>
						<dt class="text-slate-500">{returnedLabel}</dt>
						<dd class="text-right font-bold text-slate-900 tabular-nums">
							{item.returned_qty ?? '0'}
							{unit}
						</dd>
						<dt class="text-slate-500">ส่วนต่าง</dt>
						<dd class="text-right tabular-nums">{item.discrepancy_qty ?? '0'} {unit}</dd>
					</dl>
				</li>
			{/each}
		</ul>
		<!-- Tablet and up: table -->
		<div class="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
			<table class="w-full text-left text-sm text-slate-700">
				<thead class="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
					<tr>
						<th scope="col" class="py-3 pr-3 pl-4">สินค้า</th>
						<th scope="col" class="px-3 py-3 text-right">ยอดเบิก</th>
						<th scope="col" class="px-3 py-3 text-right">แจกแล้ว</th>
						<th scope="col" class="px-3 py-3 text-right">{returnedLabel}</th>
						<th scope="col" class="py-3 pr-4 pl-3 text-right">ส่วนต่าง</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each ticket.items as item (item.item_id)}
						{@const unit = unitOf(item.item_id)}
						<tr>
							<td class="py-3 pr-3 pl-4 font-semibold text-slate-900">{item.item_name}</td>
							<td class="px-3 py-3 text-right tabular-nums">
								{item.allocated_qty} <span class="text-xs text-slate-500">{unit}</span>
							</td>
							<td class="px-3 py-3 text-right tabular-nums">
								{item.distributed_qty ?? '0'} <span class="text-xs text-slate-500">{unit}</span>
							</td>
							<td class="px-3 py-3 text-right font-bold text-slate-900 tabular-nums">
								{item.returned_qty ?? '0'}
								<span class="text-xs font-normal text-slate-500">{unit}</span>
							</td>
							<td class="py-3 pr-4 pl-3 text-right tabular-nums">
								{item.discrepancy_qty ?? '0'} <span class="text-xs text-slate-500">{unit}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/snippet}
