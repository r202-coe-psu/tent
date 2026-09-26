<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Package from '@lucide/svelte/icons/package';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader from '@lucide/svelte/icons/loader';
	import { qtyGte } from '$lib/utils/qty';
	import { validatePositiveQuantity } from '../model/ticket-quantity';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		resolveAuthenticatedAuthorContext,
		useDistributionLogs,
		useRecordSuppliesDistribution
	} from '../../application/queries';
	import {
		canPerformFrontlineDistribution,
		canDispatchTicket
	} from '../../application/food-supplies/auth';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		canRecipientReceiveItem,
		getItemCapacitySummary,
		getRecipientValidationErrorMessage,
		type FrontlineRecipientSelection
	} from '../model/frontline-handover';
	import { formatDistributionError } from '../model/distribution-error';
	import RecipientSearchPicker from '../common/RecipientSearchPicker.svelte';
	import InFlightTopUpDialog from './InFlightTopUpDialog.svelte';

	interface Props {
		ticket: RequisitionTicket;
		shelterCode?: string;
	}

	let { ticket, shelterCode }: Props = $props();

	const recordSuppliesMutation = useRecordSuppliesDistribution();

	// Authoritative session context — matches Slice 5.2 TicketActionPanel pattern.
	// Fails closed (canDistribute = false) if unauthenticated.
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(shelterCode);
		} catch {
			return null;
		}
	});

	const canDistribute = $derived(
		authContext ? canPerformFrontlineDistribution(authContext) : false
	);
	const canTopUp = $derived(authContext ? canDispatchTicket(authContext) : false);

	// State — selectedItemId syncs reactively; never hard-codes a prop value at initialisation
	let selectedItemId = $state('');
	let qtyInput = $state('1');
	let recipientSelection = $state<FrontlineRecipientSelection | null>(null);
	let notesInput = $state('');
	let localSubmitError = $state<string | null>(null);
	let topUpDialogOpen = $state(false);

	function handleQtyBlur() {
		const raw = qtyInput.trim();
		if (!raw) return;
		validatePositiveQuantity(raw);
	}

	// Keep selectedItemId valid when ticket prop changes (e.g. parent switches active ticket).
	$effect(() => {
		const ids = ticket.items.map((i) => i.item_id);
		if (!selectedItemId || !ids.includes(selectedItemId)) {
			selectedItemId = ids[0] ?? '';
		}
	});

	// Read queries (ticket-scoped logs for capacity calculation)
	const ticketLogsQuery = useDistributionLogs(
		() => ({ ticket_id: ticket._id }),
		() => shelterCode
	);
	const ticketLogs = $derived(ticketLogsQuery.data ?? []);

	// Selected item and in-hand capacity
	const selectedItem = $derived(
		ticket.items.find((i) => i.item_id === selectedItemId) ?? ticket.items[0]
	);
	const capacitySummary = $derived(
		selectedItem
			? getItemCapacitySummary(ticket._id, selectedItem, ticketLogs)
			: { allocatedQty: '0', distributedQty: '0', inHandQty: '0', isExhausted: true }
	);

	const isReturnableItem = $derived(Boolean(selectedItem?.returnable));

	const recipientValidation = $derived.by(() => {
		const isEligible = canRecipientReceiveItem(recipientSelection, isReturnableItem);
		const errorMsg = getRecipientValidationErrorMessage(recipientSelection, isReturnableItem);
		return { isEligible, errorMsg };
	});

	const isQtyValid = $derived.by(() => {
		const res = validatePositiveQuantity(qtyInput);
		if (!res.isValid || !res.value) return false;
		return qtyGte(capacitySummary.inHandQty, res.value);
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		localSubmitError = null;
		handleQtyBlur();
		if (!canDistribute) {
			localSubmitError =
				'คุณไม่มีสิทธิ์ในการแจกจ่ายพัสดุ (ต้องการสิทธิ์ส่วนหน้า/ผู้ประสานงาน/ผู้จัดการ)';
			return;
		}
		if (!recipientSelection) {
			localSubmitError = 'กรุณาระบุผู้รับพัสดุก่อนทำรายการ';
			return;
		}
		if (!selectedItem) {
			localSubmitError = 'กรุณาเลือกรายการพัสดุ';
			return;
		}
		if (!recipientValidation.isEligible) {
			localSubmitError = recipientValidation.errorMsg ?? 'ผู้รับไม่ถูกต้องสำหรับประเภทสิ่งของนี้';
			return;
		}
		const qtyRes = validatePositiveQuantity(qtyInput);
		if (!qtyRes.isValid || !qtyRes.value) {
			localSubmitError = qtyRes.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง';
			return;
		}
		if (!isQtyValid) {
			localSubmitError = 'จำนวนที่ระบุเกินยอดคงเหลือในมือ';
			return;
		}

		try {
			await recordSuppliesMutation.mutateAsync({
				ticketId: ticket._id,
				input: {
					item_id: selectedItem.item_id,
					qty: qtyRes.value,
					recipient_type: recipientSelection.recipientType,
					recipient_id: recipientSelection.recipientId,
					household_id:
						recipientSelection.recipientType === 'evacuee'
							? recipientSelection.householdId
							: undefined,
					notes: notesInput.trim() || undefined
				},
				shelterCode
			});

			const modeLabel = isReturnableItem ? 'ยืมสิ่งของ' : 'แจกจ่ายพัสดุ';
			toast.success(
				`บันทึก${modeLabel}สำเร็จ: ${selectedItem.item_name} จำนวน ${qtyRes.value} หน่วย`
			);

			// Reset form state
			qtyInput = '1';
			notesInput = '';
			if (recipientSelection.recipientType === 'evacuee') {
				recipientSelection = null;
			}
		} catch (err) {
			localSubmitError = formatDistributionError(
				err,
				'ไม่สามารถบันทึกแจกพัสดุได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}
</script>

<div class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
	<!-- Ticket Header -->
	<div
		class="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-2xs"
			>
				<Package class="h-6 w-6" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<span class="font-mono text-xs font-bold text-slate-500">{ticket.ticket_no}</span>
					<span
						class="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-2xs font-bold text-indigo-900"
					>
						พัสดุและอุปกรณ์บรรเทาทุกข์
					</span>
				</div>
				<h3 class="text-base font-bold text-slate-900">
					สถานีจ่ายพัสดุ & ยืม-คืน · จุดบริการ {ticket.destination_location}
				</h3>
			</div>
		</div>

		<!-- Action: In-Flight Top-Up -->
		<div class="flex items-center gap-2">
			{#if canTopUp}
				<button
					type="button"
					onclick={() => (topUpDialogOpen = true)}
					class="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 shadow-2xs transition-colors hover:bg-indigo-100"
				>
					<PlusCircle class="h-3.5 w-3.5" />
					<span>ขอเบิกเติมฉุกเฉิน (Top-Up)</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Line Items & Live In-Hand Capacity Summary -->
	<fieldset class="space-y-2">
		<legend class="block text-2xs font-bold text-slate-700 uppercase">
			รายการพัสดุในตั๋ว (ยอดคงเหลือในมือ) <span class="text-red-500">*</span>
		</legend>
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{#each ticket.items as item (item.item_id)}
				{@const summary = getItemCapacitySummary(ticket._id, item, ticketLogs)}
				{@const isSelected = selectedItemId === item.item_id}
				{@const isItemReturnable = Boolean(item.returnable)}
				<button
					type="button"
					onclick={() => (selectedItemId = item.item_id)}
					class="flex items-center justify-between rounded-xl border p-3 text-left transition-all {isSelected
						? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-500/20'
						: 'border-slate-200 bg-white hover:border-slate-300'}"
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<p class="truncate text-xs font-bold text-slate-900">{item.item_name}</p>
							<span
								class="py-0.2 shrink-0 rounded-full px-1.5 text-2xs font-bold {isItemReturnable
									? 'border border-purple-200 bg-purple-50 text-purple-800'
									: 'border border-emerald-200 bg-emerald-50 text-emerald-800'}"
							>
								{isItemReturnable ? 'ต้องคืน' : 'แจกจ่าย'}
							</span>
						</div>
						<p class="mt-0.5 text-2xs text-slate-500">
							จัดสรร: <strong class="text-slate-700">{summary.allocatedQty}</strong> | เบิก/ยืมแล้ว:
							<strong class="text-slate-700">{summary.distributedQty}</strong>
						</p>
					</div>

					<div class="ml-3 shrink-0 text-right">
						<span
							class="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold {summary.isExhausted
								? 'bg-red-100 text-red-800'
								: 'bg-indigo-100 text-indigo-900'}"
						>
							เหลือ {summary.inHandQty}
						</span>
					</div>
				</button>
			{/each}
		</div>
	</fieldset>

	<!-- Recipient Search Picker Component -->
	<RecipientSearchPicker
		bind:value={recipientSelection}
		disabled={recordSuppliesMutation.isPending}
	/>

	<!-- Warning if Returnable Loan item is selected for Outside recipient -->
	{#if isReturnableItem && recipientSelection && !recipientValidation.isEligible}
		<div
			class="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800"
			role="alert"
		>
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
			<div>
				<p class="font-bold">ไม่สามารถแจกจ่ายรายการประเภท "ต้องคืน" ได้</p>
				<p class="mt-0.5 text-2xs text-red-700">
					{recipientValidation.errorMsg}
				</p>
			</div>
		</div>
	{/if}

	<!-- Quantity & Notes Input Grid -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<div>
			<label
				for="supplies-qty-input"
				class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
			>
				จำนวนที่เบิก/ให้ยืม <span class="text-red-500">*</span>
			</label>
			<Input
				id="supplies-qty-input"
				type="text"
				inputmode="numeric"
				step="1"
				bind:value={qtyInput}
				onblur={handleQtyBlur}
				class="h-9 w-full text-xs font-bold shadow-2xs"
				disabled={recordSuppliesMutation.isPending || capacitySummary.isExhausted}
			/>
		</div>

		<div class="sm:col-span-2">
			<label
				for="supplies-notes-input"
				class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
			>
				หมายเหตุการแจกจ่าย / สภาพสิ่งของ (ถ้ามี)
			</label>
			<Input
				id="supplies-notes-input"
				type="text"
				bind:value={notesInput}
				placeholder="เช่น เบิกสำหรับเต็นท์พยาบาล, ระบุเลขซีเรียล..."
				class="h-9 w-full text-xs shadow-2xs placeholder:text-slate-400"
				disabled={recordSuppliesMutation.isPending}
			/>
		</div>
	</div>

	<!-- Error Alert -->
	{#if localSubmitError}
		<div
			class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
		>
			<AlertCircle class="h-4 w-4 shrink-0 text-red-500" />
			<span>{localSubmitError}</span>
		</div>
	{/if}

	<!-- Submit Action Button -->
	<div class="flex items-center justify-between border-t border-slate-100 pt-4">
		<div class="text-2xs text-slate-500">
			สถานะที่จะบันทึก:
			<strong class="text-slate-700">
				{isReturnableItem ? 'active (หนี้สินยืม-คืน)' : 'fulfilled (แจกจ่ายสิ้นเปลือง)'}
			</strong>
		</div>

		<button
			type="button"
			onclick={handleSubmit}
			disabled={recordSuppliesMutation.isPending ||
				capacitySummary.isExhausted ||
				!recipientSelection ||
				!recipientValidation.isEligible ||
				!isQtyValid ||
				!canDistribute}
			class="inline-flex h-10 items-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if recordSuppliesMutation.isPending}
				<Loader class="h-4 w-4 animate-spin" />
				<span>กำลังบันทึกรายการ...</span>
			{:else}
				<CheckCircle2 class="h-4 w-4" />
				<span>{isReturnableItem ? 'ยืนยันบันทึกการยืมสิ่งของ' : 'ยืนยันบันทึกแจกจ่ายพัสดุ'}</span>
			{/if}
		</button>
	</div>
</div>

<!-- In-Flight Top-Up Dialog -->
<InFlightTopUpDialog {ticket} bind:open={topUpDialogOpen} {shelterCode} />
