<script lang="ts">
	import { ulid } from '$lib/db/ulid';
	import { toast } from 'svelte-sonner';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { useAmendActiveTicket } from '../../application/queries';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { validatePositiveQuantity } from '../model/ticket-quantity';
	import { formatDistributionError } from '../model/distribution-error';
	import { addQty } from '$lib/utils/qty';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

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
	let reason = $state('');
	let localError = $state<string | null>(null);

	function handleQtyBlur() {
		const raw = addedQty.trim();
		if (!raw) return;
		validatePositiveQuantity(raw);
	}

	const selectedItem = $derived(ticket.items.find((i) => i.item_id === selectedItemId));

	// Deterministic live preview only — never used to reconstruct historical amendment data.
	const previewNewQty = $derived.by(() => {
		if (!selectedItem) return null;
		const trimmed = addedQty.trim();
		if (!trimmed) return null;
		try {
			return addQty(selectedItem.allocated_qty, trimmed);
		} catch {
			return null;
		}
	});

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
			reason = '';
		}
	});

	const canClose = $derived(!amendMutation.isPending);

	// Single funnel for every open→closed transition (built-in X, Escape, outside click,
	// footer Cancel) so reset/cleanup always runs exactly once regardless of dismissal
	// source. `open` is intentionally driven one-way here (not `bind:`) so Dialog.Root's
	// internal close attempts are routed through this function rather than silently
	// writing straight through to the bindable prop.
	function handleClose() {
		if (!canClose) return;
		open = false;
		localError = null;
		onclose?.();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		handleQtyBlur();
		if (!selectedItemId) {
			localError = 'กรุณาเลือกรายการสินค้าที่ต้องการเพิ่มจำนวน';
			return;
		}
		const qtyRes = validatePositiveQuantity(addedQty);
		if (!qtyRes.isValid || !qtyRes.value) {
			localError = qtyRes.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง';
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

			toast.success(`บันทึกการแก้ไขใบเบิกจ่ายเรียบร้อยแล้ว (+${qtyRes.value})`);
			// Reset stable ID for next operation
			amendmentId = ulid();
			handleClose();
		} catch (err) {
			localError = formatDistributionError(
				err,
				'ไม่สามารถบันทึกการแก้ไขใบเบิกจ่ายได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(next) => {
		if (!next) handleClose();
	}}
>
	<Dialog.Content
		class="max-h-[90vh] overflow-y-auto p-6 sm:max-w-lg"
		closeDisabled={!canClose}
		onEscapeKeydown={(e) => {
			if (!canClose) e.preventDefault();
		}}
		onInteractOutside={(e) => {
			if (!canClose) e.preventDefault();
		}}
	>
		<Dialog.Header>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-2xs"
				>
					<PlusCircle class="h-5 w-5" />
				</div>
				<div>
					<Dialog.Title class="text-base font-bold text-slate-900">
						แก้ไขใบเบิกจ่ายระหว่างแจก
					</Dialog.Title>
					<Dialog.Description class="text-xs text-slate-500">
						ตั๋ว: <strong>{ticket.ticket_no}</strong> (ปลายทาง: {ticket.destination_location})
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<!-- Dialog Body Form -->
		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-indigo-950">
				<p>
					จำนวนที่เพิ่มจะถูกรวมในใบเบิกจ่ายปัจจุบันทันที ตัดสต็อกคลังสินค้าจริง
					และบันทึกเป็นประวัติการแก้ไขที่ย้อนดูได้ โดยสถานะตั๋วยังคงเป็น
					<strong>กำลังแจกจ่าย</strong>
				</p>
				<p class="mt-1 font-mono text-2xs text-indigo-700">
					รหัสอ้างอิงรายการ: {amendmentId}
				</p>
			</div>

			<!-- Item Selector -->
			<div>
				<label
					for="topup-item-select"
					class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
				>
					เลือกสินค้าในตั๋วที่ต้องการเพิ่มจำนวน <span class="text-red-500">*</span>
				</label>
				<Select.Root type="single" bind:value={selectedItemId} disabled={amendMutation.isPending}>
					<Select.Trigger
						id="topup-item-select"
						aria-label="เลือกสินค้าในตั๋วที่ต้องการเพิ่มจำนวน"
						class="h-9 w-full rounded-lg text-xs shadow-2xs"
					>
						<span class="truncate">
							{selectedItem ? selectedItem.item_name : 'เลือกสินค้าในตั๋ว'}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each ticket.items as item (item.item_id)}
							<Select.Item value={item.item_id} label={item.item_name} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Current / Added / New quantity summary — this workflow only ever ADDS quantity -->
			{#if selectedItem}
				<div class="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
					<div class="grid grid-cols-3 gap-2 text-center">
						<div>
							<p class="text-3xs font-semibold tracking-wide text-slate-500 uppercase">
								จำนวนปัจจุบัน
							</p>
							<p class="text-sm font-bold text-slate-800 tabular-nums">
								{selectedItem.allocated_qty}
							</p>
						</div>
						<div>
							<p class="text-3xs font-semibold tracking-wide text-slate-500 uppercase">
								เพิ่มจำนวน
							</p>
							<p class="text-sm font-bold text-indigo-700 tabular-nums">
								+{addedQty.trim() || '0'}
							</p>
						</div>
						<div>
							<p class="text-3xs font-semibold tracking-wide text-slate-500 uppercase">จำนวนใหม่</p>
							<p class="text-sm font-extrabold text-emerald-700 tabular-nums">
								{previewNewQty ?? '-'}
							</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Added Quantity -->
			<div>
				<label for="topup-qty-input" class="mb-1 block text-2xs font-bold text-slate-700 uppercase">
					จำนวนที่ต้องการเพิ่มในใบเบิกจ่าย <span class="text-red-500">*</span>
				</label>
				<Input
					id="topup-qty-input"
					type="text"
					inputmode="numeric"
					step="1"
					bind:value={addedQty}
					onblur={handleQtyBlur}
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
					เหตุผลในการแก้ไขใบเบิกจ่าย
				</label>
				<Input
					id="topup-reason-input"
					type="text"
					bind:value={reason}
					placeholder="ระบุเหตุผลที่ต้องเพิ่มจำนวนสินค้า"
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
				<Button
					type="button"
					variant="outline"
					onclick={handleClose}
					disabled={!canClose}
					class="h-auto rounded-xl border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed"
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					disabled={amendMutation.isPending}
					class="h-auto rounded-xl border-indigo-600 bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-700 disabled:cursor-not-allowed"
				>
					{#if amendMutation.isPending}
						<Loader class="h-3.5 w-3.5 animate-spin" />
						<span>กำลังบันทึก...</span>
					{:else}
						<span>ยืนยันแก้ไขใบเบิกจ่าย</span>
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
