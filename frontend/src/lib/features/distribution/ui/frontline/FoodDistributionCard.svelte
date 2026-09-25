<script lang="ts">
	import { toast } from 'svelte-sonner';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader from '@lucide/svelte/icons/loader';
	import { qtyGte } from '$lib/utils/qty';
	import {
		validatePositiveQuantity,
		normalizeWholeItemInput,
		formatNormalizationNotice
	} from '../model/ticket-quantity';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		resolveAuthenticatedAuthorContext,
		useDistributionLogs,
		useRecordFoodDistribution
	} from '../../application/queries';
	import {
		canPerformFrontlineDistribution,
		canDispatchTicket
	} from '../../application/food-supplies/auth';
	import type { RequisitionTicket, MealPeriod } from '../../domain/food-supplies';
	import {
		checkDuplicateMealAdvisory,
		getItemCapacitySummary,
		type FrontlineRecipientSelection
	} from '../model/frontline-handover';
	import { formatDistributionError } from '../model/distribution-error';
	import RecipientSearchPicker from '../common/RecipientSearchPicker.svelte';
	import MealEntitlementWarning from './MealEntitlementWarning.svelte';
	import InFlightTopUpDialog from './InFlightTopUpDialog.svelte';

	interface Props {
		ticket: RequisitionTicket;
		shelterCode?: string;
	}

	let { ticket, shelterCode }: Props = $props();

	const recordFoodMutation = useRecordFoodDistribution();

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
	let qtyNotice = $state<string | null>(null);
	let recipientSelection = $state<FrontlineRecipientSelection | null>(null);
	let notesInput = $state('');
	let warningModalOpen = $state(false);
	let localSubmitError = $state<string | null>(null);
	let topUpDialogOpen = $state(false);

	function handleQtyBlur() {
		const raw = qtyInput.trim();
		if (!raw) return;
		const normRes = normalizeWholeItemInput(raw);
		if (normRes.normalized !== null) {
			if (normRes.wasNormalized) {
				qtyNotice = formatNormalizationNotice(raw, normRes.normalized, 'ชุด');
			}
			qtyInput = normRes.normalized;
		}
	}

	// Keep selectedItemId valid when ticket prop changes (e.g. parent switches active ticket).
	$effect(() => {
		const ids = ticket.items.map((i) => i.item_id);
		if (!selectedItemId || !ids.includes(selectedItemId)) {
			selectedItemId = ids[0] ?? '';
		}
	});

	// Read queries
	const ticketLogsQuery = useDistributionLogs(
		() => ({ ticket_id: ticket._id }),
		() => shelterCode
	);
	const ticketLogs = $derived(ticketLogsQuery.data ?? []);

	// Recipient-scoped cross-ticket logs for duplicate meal preflight
	const recipientLogsQuery = useDistributionLogs(
		() =>
			recipientSelection?.recipientId
				? { recipient_id: recipientSelection.recipientId }
				: undefined,
		() => shelterCode,
		() => Boolean(recipientSelection?.recipientId)
	);
	const recipientLogs = $derived(recipientLogsQuery.data ?? []);

	// Selected item and in-hand capacity
	const selectedItem = $derived(
		ticket.items.find((i) => i.item_id === selectedItemId) ?? ticket.items[0]
	);
	const capacitySummary = $derived(
		selectedItem
			? getItemCapacitySummary(ticket._id, selectedItem, ticketLogs)
			: { allocatedQty: '0', distributedQty: '0', inHandQty: '0', isExhausted: true }
	);

	// Advisory duplicate preflight
	const duplicatePreflight = $derived(
		recipientSelection?.recipientType === 'evacuee'
			? checkDuplicateMealAdvisory(recipientLogs, ticket.meal)
			: { isDuplicate: false, priorLog: null }
	);

	const mealLabels: Record<MealPeriod, string> = {
		breakfast: 'เช้า (Breakfast)',
		lunch: 'กลางวัน (Lunch)',
		dinner: 'เย็น (Dinner)',
		snack: 'อาหารว่าง (Snack)'
	};

	const isQtyValid = $derived.by(() => {
		const res = validatePositiveQuantity(qtyInput);
		if (!res.isValid || !res.value) return false;
		return qtyGte(capacitySummary.inHandQty, res.value);
	});

	function handleSubmitClick(e: Event) {
		e.preventDefault();
		localSubmitError = null;

		if (!canDistribute) {
			localSubmitError =
				'คุณไม่มีสิทธิ์ในการแจกจ่ายอาหาร (ต้องการสิทธิ์ส่วนหน้า/ผู้ประสานงาน/ผู้จัดการ)';
			return;
		}
		if (!recipientSelection) {
			localSubmitError = 'กรุณาระบุผู้รับอาหารก่อนทำรายการ';
			return;
		}
		if (!selectedItem) {
			localSubmitError = 'กรุณาเลือกรายการอาหาร';
			return;
		}
		if (!isQtyValid) {
			localSubmitError = 'จำนวนที่ระบุเกินยอดคงเหลือในมือ';
			return;
		}

		// Advisory duplicate check: if duplicate detected, open override warning modal
		if (duplicatePreflight.isDuplicate) {
			warningModalOpen = true;
			return;
		}

		// Normal submit without duplicate
		executeHandover(false);
	}

	async function executeHandover(isOverride: boolean, overrideReason?: string) {
		if (!selectedItem || !recipientSelection) return;
		handleQtyBlur();
		const qtyRes = validatePositiveQuantity(qtyInput);
		if (!qtyRes.isValid || !qtyRes.value) {
			localSubmitError = qtyRes.error ?? 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
			return;
		}
		if (!isQtyValid) {
			localSubmitError = 'จำนวนที่ระบุเกินยอดคงเหลือในมือ';
			return;
		}

		localSubmitError = null;
		try {
			await recordFoodMutation.mutateAsync({
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
					is_override: isOverride,
					override_reason: overrideReason,
					// CRITICAL: cooking_completed_at MUST remain omitted in Slice 5.4 (FOOD_4H_TIMESTAMP_BLOCKER)
					notes: notesInput.trim() || undefined
				},
				shelterCode
			});

			toast.success(`บันทึกแจกอาหารสำเร็จ: ${selectedItem.item_name} จำนวน ${qtyRes.value} ชุด`);
			// Reset form state
			warningModalOpen = false;
			qtyNotice = null;
			qtyInput = '1';
			notesInput = '';
			if (recipientSelection.recipientType === 'evacuee') {
				recipientSelection = null;
			}
		} catch (err) {
			localSubmitError = formatDistributionError(
				err,
				'ไม่สามารถบันทึกแจกอาหารได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}

	function handleOverrideConfirm(reason: string) {
		warningModalOpen = false;
		executeHandover(true, reason);
	}
</script>

<div class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
	<!-- Ticket & Meal Period Header -->
	<div
		class="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 shadow-2xs"
			>
				<UtensilsCrossed class="h-6 w-6" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<span class="font-mono text-xs font-bold text-slate-500">{ticket.ticket_no}</span>
					<span
						class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-bold text-amber-900"
					>
						อาหารปรุงสำเร็จ
					</span>
					{#if ticket.meal}
						<span
							class="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-2xs font-bold text-sky-900"
						>
							มื้อ: {mealLabels[ticket.meal] || ticket.meal}
						</span>
					{/if}
				</div>
				<h3 class="text-base font-bold text-slate-900">
					สถานีแจกจ่ายอาหาร · จุดบริการ {ticket.destination_location}
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
			รายการอาหารในตั๋ว (ยอดคงเหลือในมือ) <span class="text-red-500">*</span>
		</legend>
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{#each ticket.items as item (item.item_id)}
				{@const summary = getItemCapacitySummary(ticket._id, item, ticketLogs)}
				{@const isSelected = selectedItemId === item.item_id}
				<button
					type="button"
					onclick={() => (selectedItemId = item.item_id)}
					class="flex items-center justify-between rounded-xl border p-3 text-left transition-all {isSelected
						? 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/20'
						: 'border-slate-200 bg-white hover:border-slate-300'}"
				>
					<div class="min-w-0 flex-1">
						<p class="truncate text-xs font-bold text-slate-900">{item.item_name}</p>
						<p class="text-2xs text-slate-500">
							จัดสรร: <strong class="text-slate-700">{summary.allocatedQty}</strong> | แจกแล้ว:
							<strong class="text-slate-700">{summary.distributedQty}</strong>
						</p>
					</div>

					<div class="ml-3 shrink-0 text-right">
						<span
							class="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold {summary.isExhausted
								? 'bg-red-100 text-red-800'
								: 'bg-emerald-100 text-emerald-900'}"
						>
							เหลือ {summary.inHandQty}
						</span>
					</div>
				</button>
			{/each}
		</div>
	</fieldset>

	<!-- Recipient Search Picker Component -->
	<RecipientSearchPicker bind:value={recipientSelection} disabled={recordFoodMutation.isPending} />

	<!-- Advisory Duplicate Meal Warning Banner -->
	{#if duplicatePreflight.isDuplicate}
		<div
			class="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950"
			role="alert"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
			<div>
				<p class="font-bold">ตรวจพบประวัติการรับอาหารซ้ำในรอบวัน (Advisory Warning)</p>
				<p class="mt-0.5 text-2xs text-amber-800">
					ผู้ประสบภัยรายนี้ได้รับอาหารมื้อ {ticket.meal ? mealLabels[ticket.meal] : ''} ในรอบวันแล้ว หากกดแจกจ่าย
					ระบบจะแสดงหน้าต่างเพื่อบันทึกเหตุผล Override
				</p>
			</div>
		</div>
	{/if}

	<!-- Quantity & Notes Input Grid -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<div>
			<label for="food-qty-input" class="mb-1 block text-2xs font-bold text-slate-700 uppercase">
				จำนวนชุดที่แจก <span class="text-red-500">*</span>
			</label>
			<Input
				id="food-qty-input"
				type="text"
				inputmode="decimal"
				bind:value={qtyInput}
				onblur={handleQtyBlur}
				oninput={() => {
					qtyNotice = null;
				}}
				class="h-9 w-full text-xs font-bold shadow-2xs"
				disabled={recordFoodMutation.isPending || capacitySummary.isExhausted}
			/>
			{#if qtyNotice}
				<p class="mt-1 text-2xs font-medium text-amber-700" role="status">
					{qtyNotice}
				</p>
			{/if}
		</div>

		<div class="sm:col-span-2">
			<label for="food-notes-input" class="mb-1 block text-2xs font-bold text-slate-700 uppercase">
				หมายเหตุการแจกจ่าย (ถ้ามี)
			</label>
			<Input
				id="food-notes-input"
				type="text"
				bind:value={notesInput}
				placeholder="เช่น ขอรับเพิ่มสำหรับเด็กเล็ก, แจกพร้อมน้ำดื่ม..."
				class="h-9 w-full text-xs shadow-2xs placeholder:text-slate-400"
				disabled={recordFoodMutation.isPending}
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
	<div class="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
		<button
			type="button"
			onclick={handleSubmitClick}
			disabled={recordFoodMutation.isPending ||
				capacitySummary.isExhausted ||
				!recipientSelection ||
				!isQtyValid ||
				!canDistribute}
			class="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-600 bg-amber-600 px-5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if recordFoodMutation.isPending}
				<Loader class="h-4 w-4 animate-spin" />
				<span>กำลังบันทึกแจกอาหาร...</span>
			{:else}
				<CheckCircle2 class="h-4 w-4" />
				<span>ยืนยันบันทึกแจกอาหาร</span>
			{/if}
		</button>
	</div>
</div>

<!-- Duplicate Meal Override Warning Modal -->
{#if ticket.meal && recipientSelection}
	<MealEntitlementWarning
		open={warningModalOpen}
		meal={ticket.meal}
		recipientLabel={recipientSelection.label}
		priorDistributedAt={duplicatePreflight.priorLog?.distributed_at}
		onconfirm={handleOverrideConfirm}
		oncancel={() => (warningModalOpen = false)}
	/>
{/if}

<!-- In-Flight Top-Up Dialog -->
<InFlightTopUpDialog {ticket} bind:open={topUpDialogOpen} {shelterCode} />
