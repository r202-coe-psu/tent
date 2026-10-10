<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Package from '@lucide/svelte/icons/package';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader from '@lucide/svelte/icons/loader';
	import { qtyGte } from '$lib/utils/qty';
	import { validatePositiveQuantity } from '../model/ticket-quantity';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		resolveAuthenticatedAuthorContext,
		useDistributionLogs,
		useRecordSuppliesDistribution
	} from '../../application/queries';
	import { canPerformFrontlineDistribution } from '../../application/food-supplies/auth';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		canRecipientReceiveItem,
		getItemCapacitySummary,
		getRecipientValidationErrorMessage,
		type FrontlineRecipientSelection
	} from '../model/frontline-handover';
	import { formatDistributionError } from '../model/distribution-error';
	import RecipientSearchPicker from '../common/RecipientSearchPicker.svelte';
	import QtyStepper from '../common/QtyStepper.svelte';
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

	// Item the user picked; the effective selection falls back to the first ticket item whenever
	// the pick is empty or no longer on the ticket (e.g. parent switches active ticket).
	let pickedItemId = $state('');
	let qtyInput = $state('1');
	let recipientSelection = $state<FrontlineRecipientSelection | null>(null);
	let notesInput = $state('');
	let localSubmitError = $state<string | null>(null);
	let topUpDialogOpen = $state(false);
	let picker = $state<ReturnType<typeof RecipientSearchPicker>>();

	function handleQtyBlur() {
		const raw = qtyInput.trim();
		if (!raw) return;
		validatePositiveQuantity(raw);
	}

	const selectedItemId = $derived(
		ticket.items.some((i) => i.item_id === pickedItemId)
			? pickedItemId
			: (ticket.items[0]?.item_id ?? '')
	);

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

			// Reset for the next person; a scanned recipient reopens the scanner.
			qtyInput = '1';
			notesInput = '';
			picker?.next();
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

		<!--
			Temporarily hidden: active-ticket amendment is awaiting workflow approval.
			Keep InFlightTopUpDialog and application/domain logic intact for later re-enablement.
		-->
	</div>

	<!-- Line Items & Live In-Hand Capacity Summary -->
	<fieldset class="space-y-2">
		<legend class="text-sm font-semibold text-slate-700">
			เลือกของที่จะจ่าย <span class="text-red-500">*</span>
		</legend>
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{#each ticket.items as item (item.item_id)}
				{@const summary = getItemCapacitySummary(ticket._id, item, ticketLogs)}
				{@const isSelected = selectedItemId === item.item_id}
				{@const isItemReturnable = Boolean(item.returnable)}
				<button
					type="button"
					onclick={() => (pickedItemId = item.item_id)}
					aria-pressed={isSelected}
					class="flex min-h-14 items-center justify-between rounded-xl border p-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none {isSelected
						? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-500/20'
						: 'border-slate-200 bg-white hover:border-slate-300'}"
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<p class="truncate text-base font-bold text-slate-900">{item.item_name}</p>
							<span
								class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold {isItemReturnable
									? 'border border-purple-200 bg-purple-50 text-purple-800'
									: 'border border-emerald-200 bg-emerald-50 text-emerald-800'}"
							>
								{isItemReturnable ? 'ต้องคืน' : 'แจกจ่าย'}
							</span>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							จัดสรร: <strong class="text-slate-700">{summary.allocatedQty}</strong> | เบิก/ยืมแล้ว:
							<strong class="text-slate-700">{summary.distributedQty}</strong>
						</p>
					</div>

					<div class="ml-3 shrink-0 text-right">
						<span
							class="inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums {summary.isExhausted
								? 'bg-red-100 text-red-800'
								: 'bg-indigo-100 text-indigo-900'}"
						>
							{summary.isExhausted ? 'หมดแล้ว' : `เหลือ ${summary.inHandQty}`}
						</span>
					</div>
				</button>
			{/each}
		</div>
	</fieldset>

	<!-- Recipient: scan first, then confirm -->
	<RecipientSearchPicker
		bind:this={picker}
		bind:value={recipientSelection}
		disabled={recordSuppliesMutation.isPending}
	/>

	{#if recipientSelection}
		<!-- Returnable items cannot go to an outside person -->
		{#if isReturnableItem && !recipientValidation.isEligible}
			<div
				class="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
				role="alert"
			>
				<AlertCircle class="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
				<div>
					<p class="font-bold">ของประเภท "ต้องคืน" ให้บุคคลภายนอกยืมไม่ได้</p>
					<p class="mt-0.5 text-xs text-red-700">{recipientValidation.errorMsg}</p>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<QtyStepper
				id="supplies-qty-input"
				label={isReturnableItem ? 'จำนวนที่ให้ยืม' : 'จำนวนที่จ่าย'}
				bind:value={qtyInput}
				max={capacitySummary.inHandQty}
				disabled={recordSuppliesMutation.isPending || capacitySummary.isExhausted}
			/>

			<div class="space-y-1.5">
				<Label for="supplies-notes-input" class="text-sm font-semibold text-slate-700">
					หมายเหตุ (ไม่บังคับ)
				</Label>
				<Input
					id="supplies-notes-input"
					type="text"
					bind:value={notesInput}
					placeholder="เช่น สภาพของ, เลขซีเรียล"
					class="h-12 text-sm"
					disabled={recordSuppliesMutation.isPending}
				/>
			</div>
		</div>

		{#if isReturnableItem}
			<p class="text-sm text-slate-600">
				ของชิ้นนี้<strong class="text-slate-800">ต้องคืน</strong> — ระบบจะบันทึกเป็นการยืม และผู้รับต้องนำมาคืนที่ขั้นที่
				4
			</p>
		{/if}

		<!-- Error Alert -->
		{#if localSubmitError}
			<div
				class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
				role="alert"
			>
				<AlertCircle class="size-4 shrink-0 text-red-600" aria-hidden="true" />
				<span>{localSubmitError}</span>
			</div>
		{/if}

		<Button
			type="button"
			onclick={handleSubmit}
			disabled={recordSuppliesMutation.isPending ||
				capacitySummary.isExhausted ||
				!recipientValidation.isEligible ||
				!isQtyValid ||
				!canDistribute}
			class="h-14 w-full rounded-xl bg-indigo-600 text-base font-bold hover:bg-indigo-700"
		>
			{#if recordSuppliesMutation.isPending}
				<Loader class="size-5 animate-spin" aria-hidden="true" />
				<span>กำลังบันทึก...</span>
			{:else}
				<CheckCircle2 class="size-5" aria-hidden="true" />
				<span>{isReturnableItem ? 'ยืนยันบันทึกการยืมสิ่งของ' : 'ยืนยันบันทึกแจกจ่ายพัสดุ'}</span>
			{/if}
		</Button>
		{#if !canDistribute}
			<p class="text-center text-sm text-slate-500">
				บัญชีนี้ไม่มีสิทธิ์บันทึกการจ่ายพัสดุ (ต้องเป็นเจ้าหน้าที่ส่วนหน้า ผู้ประสานงาน
				หรือผู้จัดการศูนย์)
			</p>
		{/if}
	{/if}
</div>

<!-- In-Flight Top-Up Dialog -->
<InFlightTopUpDialog {ticket} bind:open={topUpDialogOpen} {shelterCode} />
