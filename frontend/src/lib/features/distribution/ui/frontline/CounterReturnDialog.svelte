<script lang="ts">
	import { toast } from 'svelte-sonner';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import type { DistributionLog, ReturnCondition } from '../../domain/food-supplies';
	import {
		useReturnLoanAtCounter,
		useReturnOperationState,
		useAbortAbandonedReturnReservation
	} from '../../application/queries';
	import { subQty } from '$lib/utils/qty';
	import { ulid } from '$lib/db/ulid';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		calculateLoanRemainingQty,
		calculateNewCumulativeReturned,
		validateCounterReturnQuantity,
		RETURN_CONDITION_OPTIONS,
		resolveCounterRecoveryHydration,
		isReturnReservationModeCollision
	} from '../model/loan-return';
	import { dialogAccessibility } from '../model/dialog-accessibility';
	import { formatDistributionError } from '../model/distribution-error';

	interface Props {
		open?: boolean;
		log: DistributionLog | null;
		itemName?: string;
		shelterCode?: string;
		canReturnStock?: boolean;
		onsuccess?: (updatedLog: DistributionLog) => void;
		onclose?: () => void;
	}

	let {
		open = $bindable(false),
		log,
		itemName = '',
		shelterCode,
		canReturnStock = true,
		onsuccess,
		onclose
	}: Props = $props();

	const returnMutation = useReturnLoanAtCounter();
	const abortMutation = useAbortAbandonedReturnReservation();

	const operationStateQuery = useReturnOperationState(
		() => log?._id,
		() => shelterCode,
		() => Boolean(open && log?._id)
	);
	const operationState = $derived(operationStateQuery.data);

	let lastInitializedLogId = $state<string | null>(null);
	let hydratedOperationId = $state<string | null>(null);
	let operationUlid = $state<string>(ulid());
	let returningNowQty = $state('');
	let condition = $state<ReturnCondition>('READY');
	let notesInput = $state('');
	let localError = $state<string | null>(null);

	function handleReturnQtyBlur() {
		validateCounterReturnQuantity(returningNowQty, remainingQty);
	}

	// Derived metrics from authoritative log
	const previousReturned = $derived(log?.qty_returned ?? '0');
	const remainingQty = $derived(log ? calculateLoanRemainingQty(log) : '0');
	const newCumulative = $derived(calculateNewCumulativeReturned(previousReturned, returningNowQty));

	const validation = $derived(validateCounterReturnQuantity(returningNowQty, remainingQty));
	const isFullReturn = $derived(validation.isValid && log ? newCumulative === log.qty : false);

	const isCrossModeCollision = $derived(
		Boolean(
			operationState?.reservation &&
			(operationState.phase === 'PRE_EFFECT_ABORTABLE' ||
				operationState.phase === 'IRREVERSIBLE_FORWARD_ONLY') &&
			isReturnReservationModeCollision(operationState.reservation, 'PHYSICAL')
		)
	);

	const isForwardRecovery = $derived(
		Boolean(
			operationState?.phase === 'IRREVERSIBLE_FORWARD_ONLY' &&
			operationState.reservation?.mode === 'PHYSICAL'
		)
	);

	// Reset form only when opening a new dialog session or switching to a different loan record,
	// strictly preserving operator input and error message across retryable mutation failures.
	// When active reservation in PHYSICAL mode exists, adopt persisted durable intent asynchronously once.
	$effect(() => {
		if (!open || !log) {
			lastInitializedLogId = null;
			hydratedOperationId = null;
			return;
		}

		if (lastInitializedLogId !== log._id) {
			lastInitializedLogId = log._id;
			hydratedOperationId = null;
			operationUlid = ulid();
			returningNowQty = calculateLoanRemainingQty(log);
			condition = 'READY';
			notesInput = '';
			localError = null;
		}

		const hydrated = resolveCounterRecoveryHydration({
			open,
			logId: log._id,
			reservation: operationState?.reservation,
			hydratedOperationId
		});
		if (hydrated) {
			operationUlid = hydrated.operationUlid;
			if (hydrated.qtyInput) {
				returningNowQty = subQty(hydrated.qtyInput, previousReturned);
			}
			condition = hydrated.returnCondition;
			notesInput = hydrated.notes;
			hydratedOperationId = hydrated.hydratedOperationId;
		}
	});

	const canClose = $derived(
		!returnMutation.isPending && !abortMutation.isPending && !isForwardRecovery
	);

	function performClose() {
		open = false;
		localError = null;
		onclose?.();
	}

	function requestClose() {
		// Guarded user dismissal: blocked while mutation is in-flight or in forward recovery
		if (!canClose) return;
		performClose();
	}

	function closeAfterSuccess() {
		// Authoritative workflow completion: closes deterministically without depending
		// on cached return-operation-state query invalidation timing.
		performClose();
	}

	function handleSetFullReturn() {
		returningNowQty = remainingQty;
		localError = null;
	}

	async function handleAbortAndRestart() {
		if (!log) return;
		localError = null;
		try {
			await abortMutation.mutateAsync({
				logId: log._id,
				shelterCode,
				ticketId: log.ticket_id
			});
			operationUlid = ulid();
			hydratedOperationId = null;
			const rem = calculateLoanRemainingQty(log);
			returningNowQty = rem;
			condition = 'READY';
			notesInput = '';
			toast.info('ยกเลิกรายการเดิมที่ค้างอยู่แล้ว เริ่มต้นรายการใหม่');
		} catch (err) {
			localError = formatDistributionError(
				err,
				'ไม่สามารถยกเลิกรายการเดิมได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		localError = null;
		handleReturnQtyBlur();

		if (!log) {
			localError = 'ไม่พบข้อมูลรายการยืม';
			return;
		}

		if (isCrossModeCollision) {
			localError = `รายการนี้กำลังถูกดำเนินการในโหมด ${operationState?.reservation?.mode} โดย ${operationState?.reservation?.operation_by ?? 'ไม่ระบุ'} ไม่อนุญาตให้ทำรายการซ้อนข้ามโหมด`;
			return;
		}

		if (!canReturnStock) {
			localError =
				'คุณไม่มีสิทธิ์ในการบันทึกตรวจรับของคืนเข้าคลัง (ต้องการสิทธิ์คลังสินค้า/ผู้ประสานงาน/ผู้จัดการศูนย์)';
			return;
		}

		if (!validation.isValid) {
			localError = validation.error ?? 'จำนวนที่ระบุไม่ถูกต้อง';
			return;
		}

		// Snapshot immutable submission values before await to protect against
		// reactive races if loan context changes before the mutation resolves.
		const submitted = {
			logId: log._id,
			ticketId: log.ticket_id,
			itemName: itemName || log.item_id,
			returningNowQty,
			newCumulative,
			operationUlid
		};

		try {
			const result = await returnMutation.mutateAsync({
				logId: submitted.logId,
				input: {
					qty_returned: submitted.newCumulative,
					condition_on_return: condition,
					notes: notesInput.trim() || undefined,
					operationUlid: submitted.operationUlid
				},
				shelterCode,
				ticketId: submitted.ticketId
			});

			const isFull = result.log.status === 'returned';
			const successMsg = isFull
				? `บันทึกรับคืนครบเรียบร้อย: ${submitted.itemName} (จำนวน ${submitted.returningNowQty} ชิ้น)`
				: `บันทึกรับคืนบางส่วนเรียบร้อย: ${submitted.itemName} (คืนเพิ่ม ${submitted.returningNowQty} ชิ้น, รวมสะสม ${submitted.newCumulative} ชิ้น)`;

			toast.success(successMsg);
			onsuccess?.(result.log);
			closeAfterSuccess();
		} catch (err) {
			localError = formatDistributionError(err, 'ไม่สามารถบันทึกรับของคืนได้ กรุณาลองใหม่อีกครั้ง');
		}
	}
</script>

{#if open && log}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop dismissal surface -->
		<button
			type="button"
			tabindex="-1"
			aria-hidden="true"
			class="fixed inset-0 cursor-default border-0 bg-black/40 backdrop-blur-xs outline-none"
			onclick={() => {
				if (canClose) {
					requestClose();
				}
			}}
		></button>

		<!-- Dialog panel/container -->
		<div
			class="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl transition-all"
			role="dialog"
			aria-modal="true"
			aria-labelledby="counter-return-dialog-title"
			aria-describedby="counter-return-dialog-desc"
			tabindex="-1"
			use:dialogAccessibility={{
				canClose: () => canClose,
				onClose: requestClose
			}}
		>
			<!-- Dialog Header -->
			<div class="flex items-start justify-between border-b border-slate-100 pb-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-2xs"
					>
						<RotateCcw class="h-5 w-5" />
					</div>
					<div>
						<h2 id="counter-return-dialog-title" class="text-base font-bold text-slate-900">
							ตรวจรับคืนพัสดุเข้าคลัง (Counter Return)
						</h2>
						<p id="counter-return-dialog-desc" class="text-xs text-slate-500">
							{itemName || log.item_id} · รหัสรายการ: <span class="font-mono">{log._id}</span>
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={requestClose}
					disabled={!canClose}
					class="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="ปิดหน้าต่าง"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Authoritative In-Flight Recovery Callout (CR-134 R4) -->
			{#if isCrossModeCollision}
				<div
					class="mt-3 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-950"
					role="alert"
				>
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
					<div>
						<p class="font-bold">
							รายการนี้กำลังถูกดำเนินการในโหมดอื่น ({operationState?.reservation?.mode})
						</p>
						<p class="mt-0.5 text-2xs text-red-800">
							ผู้ทำรายการ: <strong>{operationState?.reservation?.operation_by ?? 'ไม่ระบุ'}</strong>
							ไม่อนุญาตให้ทำรายการซ้อนข้ามโหมด กรุณาใช้หน้าต่างสำหรับโหมด {operationState
								?.reservation?.mode} หรือรอจนกว่ารายการเดิมจะสิ้นสุด
						</p>
					</div>
				</div>
			{:else if operationState?.phase === 'PRE_EFFECT_ABORTABLE'}
				<div
					class="mt-3 flex items-start justify-between gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
					role="status"
				>
					<div class="flex items-start gap-2">
						<RotateCcw class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
						<div>
							<p class="font-bold">พบรายการที่อยู่ระหว่างดำเนินการ (In-Flight Pending)</p>
							<p class="mt-0.5 text-2xs text-amber-800">
								โหมด: <strong>{operationState.reservation?.mode}</strong> · ผู้ทำรายการ:
								<strong
									>{operationState.reservation?.operation_by ??
										operationState.reservation?.created_by ??
										'ไม่ระบุ'}</strong
								>
								· คุณสามารถทำรายการต่อ หรือยกเลิกรายการเพื่อเริ่มต้นใหม่
							</p>
						</div>
					</div>
					{#if operationState.canAbort}
						<button
							type="button"
							onclick={handleAbortAndRestart}
							disabled={abortMutation.isPending || returnMutation.isPending}
							class="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-2xs font-bold text-amber-900 shadow-2xs hover:bg-amber-100 disabled:opacity-50"
						>
							{#if abortMutation.isPending}
								<Loader class="inline h-3 w-3 animate-spin" />
							{:else}
								ยกเลิกและเริ่มใหม่
							{/if}
						</button>
					{/if}
				</div>
			{:else if operationState?.phase === 'IRREVERSIBLE_FORWARD_ONLY'}
				<div
					class="mt-3 flex items-start gap-2.5 rounded-xl border border-blue-300 bg-blue-50 p-3 text-xs text-blue-950"
					role="status"
				>
					<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
					<div>
						<p class="font-bold">รายการผ่านจุดบันทึกสต็อกแล้ว (Irreversible Forward Recovery)</p>
						<p class="mt-0.5 text-2xs text-blue-800">
							รายการนี้ถูกล็อก (FENCED) และมีบันทึกรับของแล้ว กำลังรอปิดสถานะรายการให้สมบูรณ์
							(ข้อมูลถูกล็อคตามรายการเดิม)
						</p>
					</div>
				</div>
			{/if}

			<!-- Dialog Body Form -->
			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<!-- Loan Balance Summary Box -->
				<div
					class="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-center"
				>
					<div>
						<p class="text-2xs font-semibold text-slate-500 uppercase">ยืมไปทั้งหมด</p>
						<p class="text-sm font-bold text-slate-800">{log.qty} ชิ้น</p>
					</div>
					<div>
						<p class="text-2xs font-semibold text-slate-500 uppercase">คืนแล้วสะสม</p>
						<p class="text-sm font-bold text-slate-700">{previousReturned} ชิ้น</p>
					</div>
					<div class="rounded-lg bg-emerald-100/60 p-1">
						<p class="text-2xs font-bold text-emerald-900 uppercase">คงค้างที่ต้องคืน</p>
						<p class="text-sm font-extrabold text-emerald-800">{remainingQty} ชิ้น</p>
					</div>
				</div>

				<!-- Return Quantity Input with Shortcut -->
				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<label
							for="return-qty-input"
							class="text-2xs font-bold tracking-wider text-slate-700 uppercase"
						>
							จำนวนที่ตรวจรับคืนครั้งนี้ <span class="text-red-500">*</span>
						</label>
						<button
							type="button"
							onclick={handleSetFullReturn}
							disabled={returnMutation.isPending ||
								!canReturnStock ||
								isForwardRecovery ||
								isCrossModeCollision}
							class="text-2xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
						>
							คืนครบทั้งหมด ({remainingQty} ชิ้น)
						</button>
					</div>

					<!-- Keep raw input as a string so inventory quantities never pass through
					     JavaScript floating-point conversion before Decimal-safe validation. -->
					<Input
						id="return-qty-input"
						type="text"
						inputmode="numeric"
						step="1"
						value={returningNowQty}
						onblur={handleReturnQtyBlur}
						oninput={(e) => {
							returningNowQty = e.currentTarget.value;
						}}
						class="h-10 w-full text-sm font-bold shadow-2xs"
						disabled={returnMutation.isPending ||
							!canReturnStock ||
							isForwardRecovery ||
							isCrossModeCollision}
						required
					/>

					<!-- Dynamic Cumulative Result Feedback -->
					{#if validation.isValid}
						<div class="flex items-center justify-between pt-0.5 text-2xs text-slate-500">
							<span>
								ยอดสะสมคืนใหม่: <strong class="text-slate-800">{newCumulative}</strong> / {log.qty} ชิ้น
							</span>
							{#if isFullReturn}
								<span
									class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700"
								>
									<CheckCircle2 class="h-3 w-3" /> คืนครบสมบูรณ์ (Close Loan)
								</span>
							{:else}
								<span
									class="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-700"
								>
									คืนบางส่วน (Partially Returned)
								</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Condition on Return Selection -->
				<div class="space-y-1.5">
					<label
						for="return-condition-select"
						class="text-2xs font-bold tracking-wider text-slate-700 uppercase"
					>
						สภาพพัสดุที่รับคืน <span class="text-red-500">*</span>
					</label>
					<Select.Root
						type="single"
						bind:value={condition}
						disabled={returnMutation.isPending ||
							!canReturnStock ||
							isForwardRecovery ||
							isCrossModeCollision}
					>
						<Select.Trigger
							id="return-condition-select"
							aria-label="สภาพพัสดุที่รับคืน"
							class="h-9 w-full rounded-xl text-xs font-semibold shadow-2xs"
						>
							<span class="truncate">
								{RETURN_CONDITION_OPTIONS.find((o) => o.value === condition)?.label ?? condition}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each RETURN_CONDITION_OPTIONS as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-2xs text-slate-500">
						{RETURN_CONDITION_OPTIONS.find((o) => o.value === condition)?.description}
					</p>
				</div>

				<!-- Notes Input -->
				<div class="space-y-1.5">
					<label
						for="return-notes-input"
						class="text-2xs font-bold tracking-wider text-slate-700 uppercase"
					>
						หมายเหตุการรับคืน (ถ้ามี)
					</label>
					<Input
						id="return-notes-input"
						type="text"
						bind:value={notesInput}
						placeholder="เช่น สภาพดีพร้อมใช้, มีรอยเปื้อนเล็กน้อย..."
						class="h-9 w-full text-xs shadow-2xs placeholder:text-slate-400"
						disabled={returnMutation.isPending ||
							!canReturnStock ||
							isForwardRecovery ||
							isCrossModeCollision}
					/>
				</div>

				<!-- Error Banner -->
				{#if localError}
					<div
						class="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
						role="alert"
					>
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
						<span>{localError}</span>
					</div>
				{/if}

				<!-- Action Buttons -->
				<div class="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
					<button
						type="button"
						onclick={requestClose}
						disabled={!canClose}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						ยกเลิก
					</button>

					<button
						type="submit"
						disabled={returnMutation.isPending ||
							!validation.isValid ||
							!canReturnStock ||
							isCrossModeCollision}
						class="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-600 bg-emerald-600 px-5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if returnMutation.isPending}
							<Loader class="h-4 w-4 animate-spin" />
							<span>กำลังบันทึกรับคืน...</span>
						{:else if isForwardRecovery}
							<CheckCircle2 class="h-4 w-4" />
							<span>ดำเนินการต่อให้สมบูรณ์ (Resume Forward)</span>
						{:else}
							<RotateCcw class="h-4 w-4" />
							<span>ยืนยันตรวจรับคืนเข้าคลัง</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
