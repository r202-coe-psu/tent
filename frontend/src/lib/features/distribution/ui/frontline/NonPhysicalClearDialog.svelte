<script lang="ts">
	import { toast } from 'svelte-sonner';
	import FileX from '@lucide/svelte/icons/file-x';
	import X from '@lucide/svelte/icons/x';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import type { DistributionLog } from '../../domain/food-supplies';
	import { useClearLoanNonPhysical } from '../../application/queries';
	import {
		calculateLoanRemainingQty,
		type NonPhysicalClearReason,
		NON_PHYSICAL_CLEAR_REASON_OPTIONS,
		validateNonPhysicalClear,
		shouldResetLoanDialog
	} from '../model/loan-return';

	interface Props {
		open?: boolean;
		log: DistributionLog | null;
		itemName?: string;
		shelterCode?: string;
		canClearLoan?: boolean;
		onsuccess?: (updatedLog: DistributionLog) => void;
		onclose?: () => void;
	}

	let {
		open = $bindable(false),
		log,
		itemName = '',
		shelterCode,
		canClearLoan = true,
		onsuccess,
		onclose
	}: Props = $props();

	const clearMutation = useClearLoanNonPhysical();

	let lastInitializedLogId = $state<string | null>(null);
	let selectedReason = $state<NonPhysicalClearReason>('lost');
	let notesInput = $state('');
	let localError = $state<string | null>(null);

	// Derived metrics from authoritative log
	const previousReturned = $derived(log?.qty_returned ?? '0');
	const remainingQty = $derived(log ? calculateLoanRemainingQty(log) : '0');

	const validation = $derived(validateNonPhysicalClear(selectedReason, notesInput));

	// Reset form only when opening a new dialog session or switching to a different loan record,
	// strictly preserving operator input and error message across retryable mutation failures.
	$effect(() => {
		if (open && log) {
			if (shouldResetLoanDialog(lastInitializedLogId, open, log._id)) {
				lastInitializedLogId = log._id;
				selectedReason = 'lost';
				notesInput = '';
				localError = null;
			}
		} else if (!open) {
			lastInitializedLogId = null;
		}
	});

	function handleClose() {
		if (clearMutation.isPending) return;
		open = false;
		localError = null;
		onclose?.();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		localError = null;

		if (!log) {
			localError = 'ไม่พบข้อมูลรายการยืม';
			return;
		}

		if (!canClearLoan) {
			localError =
				'คุณไม่มีสิทธิ์ในการตัดจำหน่ายรายการยืม (ต้องการสิทธิ์เจ้าหน้าที่ส่วนหน้า/ผู้ประสานงาน/ผู้จัดการศูนย์)';
			return;
		}

		if (!validation.isValid) {
			localError = validation.error ?? 'ข้อมูลที่ระบุไม่ถูกต้อง';
			return;
		}

		// Snapshot immutable submission values before await to protect against
		// reactive races if loan context changes before the mutation resolves.
		const submitted = {
			logId: log._id,
			ticketId: log.ticket_id,
			itemName: itemName || log.item_id,
			clearReason: selectedReason,
			remainingQty
		};

		try {
			const updatedLog = await clearMutation.mutateAsync({
				logId: submitted.logId,
				input: {
					clear_reason: submitted.clearReason,
					notes: notesInput.trim()
				},
				shelterCode,
				ticketId: submitted.ticketId
			});

			const reasonLabel = submitted.clearReason === 'lost' ? 'สูญหาย' : 'ยกเว้นการคืน';
			const successMsg = `บันทึกตัดจำหน่าย (${reasonLabel}) เรียบร้อย: ${submitted.itemName} (ตัดยอดคงค้าง ${submitted.remainingQty} ชิ้น · ไม่มีของคืนเข้าคลัง)`;

			toast.success(successMsg);
			onsuccess?.(updatedLog);
			handleClose();
		} catch (err) {
			const errorMsg = (err as Error).message;
			if (errorMsg.includes('ConflictError') || errorMsg.includes('conflict')) {
				localError =
					'ข้อมูลรายการยืมนี้มีการเปลี่ยนแปลงจากจุดอื่น กรุณาปิดหน้าต่างแล้วตรวจสอบสถานะล่าสุดก่อนทำรายการใหม่';
			} else {
				localError = `ไม่สามารถตัดจำหน่ายรายการได้: ${errorMsg}`;
			}
		}
	}
</script>

{#if open && log}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		aria-labelledby="non-physical-clear-dialog-title"
	>
		<div
			class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl transition-all"
		>
			<!-- Dialog Header -->
			<div class="flex items-start justify-between border-b border-slate-100 pb-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-slate-100 text-slate-700 shadow-2xs"
					>
						<FileX class="h-5 w-5" />
					</div>
					<div>
						<h2 id="non-physical-clear-dialog-title" class="text-base font-bold text-slate-900">
							ตัดจำหน่ายรายการโดยไม่มีของคืน (Non-Physical Clear)
						</h2>
						<p class="text-xs text-slate-500">
							{itemName || log.item_id} · รหัสรายการ: <span class="font-mono">{log._id}</span>
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={handleClose}
					disabled={clearMutation.isPending}
					class="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="ปิดหน้าต่าง"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Critical Invariant Warning Callout -->
			<div
				class="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950"
				role="note"
			>
				<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
				<div>
					<p class="font-bold">การตัดจำหน่ายทางธุรการ (Administrative Write-Off)</p>
					<p class="mt-0.5 text-2xs text-amber-800">
						การดำเนินการนี้เพื่อปิดภาระการส่งคืนพัสดุของผู้ประสบภัย <strong
							>โดยจะไม่มีการบันทึกตรวจรับของคืนเข้าคลังสินค้า และไม่เพิ่มยอดสต็อกสินค้า (No Stock
							Receipt)</strong
						>
					</p>
				</div>
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
					<div class="rounded-lg bg-red-50 p-1">
						<p class="text-2xs font-bold text-red-700 uppercase">ยอดที่จะตัดจำหน่าย</p>
						<p class="text-sm font-extrabold text-red-800">{remainingQty} ชิ้น</p>
					</div>
				</div>

				<!-- Reason Selection -->
				<div class="space-y-2">
					<label
						for="clear-reason-group"
						class="text-2xs font-bold tracking-wider text-slate-700 uppercase"
					>
						เหตุผลในการตัดจำหน่าย <span class="text-red-500">*</span>
					</label>

					<div id="clear-reason-group" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each NON_PHYSICAL_CLEAR_REASON_OPTIONS as opt (opt.value)}
							<label
								class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-all {selectedReason ===
								opt.value
									? 'border-slate-800 bg-slate-50 shadow-2xs ring-1 ring-slate-800'
									: 'border-slate-200 bg-white hover:border-slate-300'}"
							>
								<input
									type="radio"
									name="clear-reason"
									value={opt.value}
									bind:group={selectedReason}
									class="mt-0.5 text-slate-900 focus:ring-slate-900"
									disabled={clearMutation.isPending || !canClearLoan}
								/>
								<div>
									<p class="text-xs font-bold text-slate-900">{opt.label}</p>
									<p class="mt-0.5 text-2xs text-slate-500">{opt.description}</p>
								</div>
							</label>
						{/each}
					</div>
				</div>

				<!-- Mandatory Notes Input -->
				<div class="space-y-1.5">
					<label
						for="clear-notes-input"
						class="text-2xs font-bold tracking-wider text-slate-700 uppercase"
					>
						หมายเหตุ / เหตุผลประกอบการตัดจำหน่าย <span class="text-red-500">*</span>
					</label>
					<textarea
						id="clear-notes-input"
						rows="3"
						bind:value={notesInput}
						placeholder="ระบุรายละเอียด เช่น พัดลมสูญหายระหว่างเหตุอุทกภัย, ได้รับอนุมัติยกเว้นโดยผู้จัดการศูนย์..."
						class="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs placeholder:text-slate-400 focus:border-slate-800 focus:ring-1 focus:ring-slate-800 focus:outline-none"
						disabled={clearMutation.isPending || !canClearLoan}
						required
					></textarea>
					<p class="text-2xs text-slate-400">
						* จำเป็นต้องระบุหมายเหตุเพื่อบันทึกประวัติการตรวจสอบย้อนหลังตามเกณฑ์ VDU Rule 13
					</p>
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
						disabled={clearMutation.isPending}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						ยกเลิก
					</button>

					<button
						type="submit"
						disabled={clearMutation.isPending || !validation.isValid || !canClearLoan}
						class="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if clearMutation.isPending}
							<Loader class="h-4 w-4 animate-spin" />
							<span>กำลังตัดจำหน่ายรายการ...</span>
						{:else}
							<FileX class="h-4 w-4" />
							<span>ยืนยันตัดจำหน่ายรายการ</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
