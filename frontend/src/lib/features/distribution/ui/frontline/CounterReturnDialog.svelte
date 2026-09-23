<script lang="ts">
	import { toast } from 'svelte-sonner';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import type { DistributionLog, ReturnCondition } from '../../domain/food-supplies';
	import { useReturnLoanAtCounter } from '../../application/queries';
	import {
		calculateLoanRemainingQty,
		calculateNewCumulativeReturned,
		validateCounterReturnQuantity,
		RETURN_CONDITION_OPTIONS,
		shouldResetLoanDialog
	} from '../model/loan-return';

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

	let lastInitializedLogId = $state<string | null>(null);
	let returningNowQty = $state('');
	let condition = $state<ReturnCondition>('READY');
	let notesInput = $state('');
	let localError = $state<string | null>(null);

	// Derived metrics from authoritative log
	const previousReturned = $derived(log?.qty_returned ?? '0');
	const remainingQty = $derived(log ? calculateLoanRemainingQty(log) : '0');
	const newCumulative = $derived(calculateNewCumulativeReturned(previousReturned, returningNowQty));

	const validation = $derived(validateCounterReturnQuantity(returningNowQty, remainingQty));
	const isFullReturn = $derived(validation.isValid && log ? newCumulative === log.qty : false);

	// Reset form only when opening a new dialog session or switching to a different loan record,
	// strictly preserving operator input and error message across retryable mutation failures.
	$effect(() => {
		if (open && log) {
			if (shouldResetLoanDialog(lastInitializedLogId, open, log._id)) {
				lastInitializedLogId = log._id;
				const rem = calculateLoanRemainingQty(log);
				returningNowQty = rem;
				condition = 'READY';
				notesInput = '';
				localError = null;
			}
		} else if (!open) {
			lastInitializedLogId = null;
		}
	});

	function handleClose() {
		// Prevent closing dialog while mutation is actively in-flight
		if (returnMutation.isPending) return;
		open = false;
		localError = null;
		onclose?.();
	}

	function handleSetFullReturn() {
		returningNowQty = remainingQty;
		localError = null;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		localError = null;

		if (!log) {
			localError = 'ไม่พบข้อมูลรายการยืม';
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
			newCumulative
		};

		try {
			const result = await returnMutation.mutateAsync({
				logId: submitted.logId,
				input: {
					qty_returned: submitted.newCumulative,
					condition_on_return: condition,
					notes: notesInput.trim() || undefined
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
			handleClose();
		} catch (err) {
			const errorMsg = (err as Error).message;
			if (errorMsg.includes('ConflictError') || errorMsg.includes('conflict')) {
				localError =
					'ข้อมูลรายการยืมนี้มีการเปลี่ยนแปลงจากจุดอื่น กรุณาปิดหน้าต่างแล้วตรวจสอบยอดคงค้างล่าสุดก่อนทำรายการใหม่';
			} else {
				localError = `ไม่สามารถบันทึกรับของคืนได้: ${errorMsg}`;
			}
		}
	}
</script>

{#if open && log}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		aria-labelledby="counter-return-dialog-title"
	>
		<div
			class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl transition-all"
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
						<p class="text-xs text-slate-500">
							{itemName || log.item_id} · รหัสรายการ: <span class="font-mono">{log._id}</span>
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={handleClose}
					disabled={returnMutation.isPending}
					class="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="ปิดหน้าต่าง"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

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
							disabled={returnMutation.isPending || !canReturnStock}
							class="text-2xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
						>
							คืนครบทั้งหมด ({remainingQty} ชิ้น)
						</button>
					</div>

					<!-- Keep raw input as a string so inventory quantities never pass through
					     JavaScript floating-point conversion before Decimal-safe validation. -->
					<input
						id="return-qty-input"
						type="number"
						step="any"
						min="0.0001"
						max={remainingQty}
						value={returningNowQty}
						oninput={(e) => {
							returningNowQty = e.currentTarget.value;
						}}
						class="h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-900 shadow-2xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
						disabled={returnMutation.isPending || !canReturnStock}
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
					<select
						id="return-condition-select"
						bind:value={condition}
						class="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 shadow-2xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
						disabled={returnMutation.isPending || !canReturnStock}
					>
						{#each RETURN_CONDITION_OPTIONS as opt (opt.value)}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
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
					<input
						id="return-notes-input"
						type="text"
						bind:value={notesInput}
						placeholder="เช่น สภาพดีพร้อมใช้, มีรอยเปื้อนเล็กน้อย..."
						class="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs shadow-2xs placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
						disabled={returnMutation.isPending || !canReturnStock}
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
				<div class="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
					<button
						type="button"
						onclick={handleClose}
						disabled={returnMutation.isPending}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						ยกเลิก
					</button>

					<button
						type="submit"
						disabled={returnMutation.isPending || !validation.isValid || !canReturnStock}
						class="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-600 bg-emerald-600 px-5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if returnMutation.isPending}
							<Loader class="h-4 w-4 animate-spin" />
							<span>กำลังบันทึกรับคืน...</span>
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
