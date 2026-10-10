<script lang="ts">
	import { toast } from 'svelte-sonner';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader from '@lucide/svelte/icons/loader';
	import { qtyGte } from '$lib/utils/qty';
	import { validatePositiveQuantity } from '../model/ticket-quantity';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useItemMasters } from '$lib/features/catalog';
	import {
		resolveAuthenticatedAuthorContext,
		useDistributionLogs,
		useRecordFoodDistribution
	} from '../../application/queries';
	import { canPerformFrontlineDistribution } from '../../application/food-supplies/auth';
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import {
		checkDuplicateMealAdvisory,
		checkMenuMatchAdvisory,
		formatMenuTags,
		getItemCapacitySummary,
		type FrontlineRecipientSelection
	} from '../model/frontline-handover';
	import { formatDistributionError } from '../model/distribution-error';
	import { getMealPeriodLabel } from '../model/ticket-status';
	import RecipientSearchPicker from '../common/RecipientSearchPicker.svelte';
	import QtyStepper from '../common/QtyStepper.svelte';
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

	// Item the user picked; the effective selection falls back to the first ticket item whenever
	// the pick is empty or no longer on the ticket (e.g. parent switches active ticket).
	let pickedItemId = $state('');
	let qtyInput = $state('1');
	let recipientSelection = $state<FrontlineRecipientSelection | null>(null);
	let notesInput = $state('');
	let warningModalOpen = $state(false);
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

	// Advisory menu matching (draft-meal-recipient-menu-matching, option A): menu tags come from
	// the catalog item_master; an item the catalog does not know counts as a general menu.
	const itemMastersQuery = useItemMasters(() => shelterCode ?? null);
	const selectedMenu = $derived(
		itemMastersQuery.data?.find((item) => item._id === selectedItem?.item_id)
	);
	const menuPreflight = $derived(checkMenuMatchAdvisory(recipientSelection, selectedMenu));
	const menuMismatchLabel = $derived(
		menuPreflight.isMismatch ? formatMenuTags(menuPreflight.menuTags) : null
	);

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

		// Duplicate meal or menu mismatch: open the override warning modal (reason required)
		if (duplicatePreflight.isDuplicate || menuPreflight.isMismatch) {
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
			localSubmitError = qtyRes.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง';
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
			// Reset for the next person; a scanned recipient reopens the scanner.
			warningModalOpen = false;
			qtyInput = '1';
			notesInput = '';
			picker?.next();
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
							มื้อ: {getMealPeriodLabel(ticket.meal)}
						</span>
					{/if}
				</div>
				<h3 class="text-base font-bold text-slate-900">
					สถานีแจกจ่ายอาหาร · จุดบริการ {ticket.destination_location}
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
			เลือกเมนูที่จะแจก <span class="text-red-500">*</span>
		</legend>
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{#each ticket.items as item (item.item_id)}
				{@const summary = getItemCapacitySummary(ticket._id, item, ticketLogs)}
				{@const isSelected = selectedItemId === item.item_id}
				<button
					type="button"
					onclick={() => (pickedItemId = item.item_id)}
					aria-pressed={isSelected}
					class="flex min-h-14 items-center justify-between rounded-xl border p-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none {isSelected
						? 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/20'
						: 'border-slate-200 bg-white hover:border-slate-300'}"
				>
					<div class="min-w-0 flex-1">
						<p class="truncate text-base font-bold text-slate-900">{item.item_name}</p>
						<p class="text-xs text-slate-500">
							จัดสรร: <strong class="text-slate-700">{summary.allocatedQty}</strong> | แจกแล้ว:
							<strong class="text-slate-700">{summary.distributedQty}</strong>
						</p>
					</div>

					<div class="ml-3 shrink-0 text-right">
						<span
							class="inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums {summary.isExhausted
								? 'bg-red-100 text-red-800'
								: 'bg-emerald-100 text-emerald-900'}"
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
		disabled={recordFoodMutation.isPending}
	/>

	{#if recipientSelection}
		<!-- Advisory Duplicate Meal Warning Banner -->
		{#if duplicatePreflight.isDuplicate}
			<div
				class="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950"
				role="alert"
			>
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
				<div>
					<p class="font-bold">คนนี้รับอาหารมื้อนี้ไปแล้ววันนี้</p>
					<p class="mt-0.5 text-xs text-amber-800">
						มื้อ{ticket.meal ? getMealPeriodLabel(ticket.meal) : ''} · ถ้ากดแจกต่อ ระบบจะขอเหตุผลก่อนบันทึก
					</p>
				</div>
			</div>
		{/if}

		<!-- Advisory Menu Mismatch Banner -->
		{#if menuMismatchLabel}
			<div
				class="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950"
				role="alert"
			>
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
				<div>
					<p class="font-bold">เมนูนี้ไม่ตรงกลุ่มผู้รับ</p>
					<p class="mt-0.5 text-xs text-amber-800">
						เมนูจัดไว้สำหรับกลุ่ม {menuMismatchLabel} · ถ้ากดแจกต่อ ระบบจะขอเหตุผลก่อนบันทึก
					</p>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<QtyStepper
				id="food-qty-input"
				label="จำนวนที่แจก"
				unit="ชุด"
				bind:value={qtyInput}
				max={capacitySummary.inHandQty}
				disabled={recordFoodMutation.isPending || capacitySummary.isExhausted}
			/>

			<div class="space-y-1.5">
				<Label for="food-notes-input" class="text-sm font-semibold text-slate-700">
					หมายเหตุ (ไม่บังคับ)
				</Label>
				<Input
					id="food-notes-input"
					type="text"
					bind:value={notesInput}
					placeholder="เช่น รับแทนผู้ป่วยติดเตียง"
					class="h-12 text-sm"
					disabled={recordFoodMutation.isPending}
				/>
			</div>
		</div>

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
			onclick={handleSubmitClick}
			disabled={recordFoodMutation.isPending ||
				capacitySummary.isExhausted ||
				!isQtyValid ||
				!canDistribute}
			class="h-14 w-full rounded-xl bg-amber-600 text-base font-bold hover:bg-amber-700"
		>
			{#if recordFoodMutation.isPending}
				<Loader class="size-5 animate-spin" aria-hidden="true" />
				<span>กำลังบันทึก...</span>
			{:else}
				<CheckCircle2 class="size-5" aria-hidden="true" />
				<span>ยืนยันแจก {selectedItem?.item_name ?? ''} {qtyInput} ชุด</span>
			{/if}
		</Button>
		{#if !canDistribute}
			<p class="text-center text-sm text-slate-500">
				บัญชีนี้ไม่มีสิทธิ์บันทึกการแจกอาหาร (ต้องเป็นเจ้าหน้าที่ส่วนหน้า ผู้ประสานงาน
				หรือผู้จัดการศูนย์)
			</p>
		{/if}
	{/if}
</div>

<!-- Duplicate Meal / Menu Mismatch Override Warning Modal -->
{#if ticket.meal && recipientSelection}
	<MealEntitlementWarning
		open={warningModalOpen}
		meal={ticket.meal}
		recipientLabel={recipientSelection.label}
		isDuplicate={duplicatePreflight.isDuplicate}
		priorDistributedAt={duplicatePreflight.priorLog?.distributed_at}
		{menuMismatchLabel}
		onconfirm={handleOverrideConfirm}
		oncancel={() => (warningModalOpen = false)}
	/>
{/if}

<!-- In-Flight Top-Up Dialog -->
<InFlightTopUpDialog {ticket} bind:open={topUpDialogOpen} {shelterCode} />
