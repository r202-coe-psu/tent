<script lang="ts">
	import { ulid } from '$lib/db/ulid';
	import { toast } from 'svelte-sonner';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import X from '@lucide/svelte/icons/x';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { useAmendActiveTicket } from '../../application/queries';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { validatePositiveQuantity } from '../model/ticket-quantity';
	import { dialogAccessibility } from '../model/dialog-accessibility';
	import { formatDistributionError } from '../model/distribution-error';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	interface Props {
		ticket: RequisitionTicket;
		open?: boolean;
		shelterCode?: string;
		onclose?: () => void;
	}

	let { ticket, open = $bindable(false), shelterCode, onclose }: Props = $props();

	const amendMutation = useAmendActiveTicket();

	// Stable ULID operation identity generated once per logical top-up session
	let amendmentId = $state(ulid());
	// selectedItemId syncs reactively via $effect — avoids Svelte state_referenced_locally warning
	let selectedItemId = $state('');
	let addedQty = $state('10');
	let reason = $state('ขอเบิกเติมฉุกเฉินหน้างาน (In-Flight Top-Up)');
	let localError = $state<string | null>(null);

	const selectedItem = $derived(ticket.items.find((i) => i.item_id === selectedItemId));

	// Keep selectedItemId valid when ticket prop changes or dialog opens.
	$effect(() => {
		const ids = ticket.items.map((i) => i.item_id);
		if (!selectedItemId || !ids.includes(selectedItemId)) {
			selectedItemId = ids[0] ?? '';
		}
	});

	// Regenerate a fresh ULID whenever the dialog opens anew
	$effect(() => {
		if (open) {
			amendmentId = ulid();
			localError = null;
		}
	});

	const canClose = $derived(!amendMutation.isPending);

	function handleClose() {
		if (!canClose) return;
		open = false;
		localError = null;
		onclose?.();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!selectedItemId) {
			localError = 'กรุณาเลือกรายการสินค้าที่ต้องการขอเบิกเติม';
			return;
		}
		const qtyRes = validatePositiveQuantity(addedQty);
		if (!qtyRes.isValid || !qtyRes.value) {
			localError = 'จำนวนที่ขอเติมต้องมากกว่า 0';
			return;
		}

		localError = null;
		try {
			// Reuses the exact same amendmentId across retries
			await amendMutation.mutateAsync({
				ticketId: ticket._id,
				input: {
					amendmentId,
					item_id: selectedItemId,
					added_qty: qtyRes.value,
					reason: reason.trim() || undefined
				},
				shelterCode
			});

			toast.success(`ขอเบิกเติมสินค้าเรียบร้อยแล้ว (+${qtyRes.value})`);
			// Reset stable ID for next operation
			amendmentId = ulid();
			handleClose();
		} catch (err) {
			localError = formatDistributionError(
				err,
				'ไม่สามารถทำรายการขอเบิกเติมได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop dismissal surface -->
		<button
			type="button"
			tabindex="-1"
			aria-hidden="true"
			class="fixed inset-0 cursor-default border-0 bg-slate-900/50 backdrop-blur-xs outline-none"
			onclick={() => {
				if (canClose) {
					handleClose();
				}
			}}
		></button>

		<!-- Dialog panel/container -->
		<div
			class="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl transition-all"
			role="dialog"
			aria-modal="true"
			aria-labelledby="topup-dialog-title"
			aria-describedby="topup-dialog-desc"
			tabindex="-1"
			use:dialogAccessibility={{
				canClose: () => canClose,
				onClose: handleClose
			}}
		>
			<!-- Dialog Header -->
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-2xs"
					>
						<PlusCircle class="h-5 w-5" />
					</div>
					<div>
						<h2 id="topup-dialog-title" class="text-base font-bold text-slate-900">
							ขอเบิกเติมฉุกเฉินระหว่างแจก (In-Flight Top-Up)
						</h2>
						<p id="topup-dialog-desc" class="text-xs text-slate-500">
							ตั๋ว: <strong>{ticket.ticket_no}</strong> (ปลายทาง: {ticket.destination_location})
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={handleClose}
					disabled={!canClose}
					class="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="ปิดหน้าต่าง"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Dialog Body Form -->
			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<div
					class="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-indigo-950"
				>
					<p>
						ระบบจะส่งรายการตัดสต็อกคลังสินค้าทันทีแบบ Real-Time และเพิ่มยอดจัดสรร (<code
							class="font-mono">allocated_qty</code
						>) บนตั๋วเดิม โดยสถานะตั๋วยังคงเป็น <strong>กำลังแจกจ่าย (DISTRIBUTING)</strong>
					</p>
					<p class="mt-1 font-mono text-2xs text-indigo-700">
						Transaction ID: {amendmentId}
					</p>
				</div>

				<!-- Item Selector -->
				<div>
					<label
						for="topup-item-select"
						class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
					>
						เลือกสินค้าในตั๋วที่ต้องการเติม <span class="text-red-500">*</span>
					</label>
					<Select.Root type="single" bind:value={selectedItemId} disabled={amendMutation.isPending}>
						<Select.Trigger
							id="topup-item-select"
							aria-label="เลือกสินค้าในตั๋วที่ต้องการเติม"
							class="h-9 w-full rounded-lg text-xs shadow-2xs"
						>
							<span class="truncate">
								{selectedItem
									? `${selectedItem.item_name} (ยอดจัดสรรปัจจุบัน: ${selectedItem.allocated_qty})`
									: 'เลือกสินค้าในตั๋ว'}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each ticket.items as item (item.item_id)}
								<Select.Item
									value={item.item_id}
									label={`${item.item_name} (ยอดจัดสรรปัจจุบัน: ${item.allocated_qty})`}
								/>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Added Quantity -->
				<div>
					<label
						for="topup-qty-input"
						class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
					>
						จำนวนที่ต้องการขอเติมเพิ่ม <span class="text-red-500">*</span>
					</label>
					<Input
						id="topup-qty-input"
						type="text"
						inputmode="decimal"
						bind:value={addedQty}
						class="h-9 w-full text-xs font-semibold shadow-2xs"
						disabled={amendMutation.isPending}
					/>
				</div>

				<!-- Reason / Notes -->
				<div>
					<label
						for="topup-reason-input"
						class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
					>
						เหตุผลในการขอเบิกเติม
					</label>
					<Input
						id="topup-reason-input"
						type="text"
						bind:value={reason}
						placeholder="เช่น มีผู้ประสบภัยย้ายมาเพิ่มจากโซนอื่น, อาหารหมดก่อนปิดรอบ..."
						class="h-9 w-full text-xs shadow-2xs placeholder:text-slate-400"
						disabled={amendMutation.isPending}
					/>
				</div>

				{#if localError}
					<div
						class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
					>
						<AlertCircle class="h-4 w-4 shrink-0 text-red-500" />
						<span>{localError}</span>
					</div>
				{/if}

				<!-- Form Actions -->
				<div class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
					<button
						type="button"
						onclick={handleClose}
						disabled={!canClose}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						ยกเลิก
					</button>
					<button
						type="submit"
						disabled={amendMutation.isPending}
						class="inline-flex items-center gap-1.5 rounded-xl border border-indigo-600 bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if amendMutation.isPending}
							<Loader class="h-3.5 w-3.5 animate-spin" />
							<span>กำลังส่งคำขอ...</span>
						{:else}
							<span>ยืนยันขอเบิกเติม</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
