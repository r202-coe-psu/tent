<script lang="ts">
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Package from '@lucide/svelte/icons/package';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader from '@lucide/svelte/icons/loader';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Info from '@lucide/svelte/icons/info';
	import FileX from '@lucide/svelte/icons/file-x';
	import {
		resolveAuthenticatedAuthorContext,
		useDistributionLogs,
		useRequisitionTickets
	} from '../../application/queries';
	import { useItemMasters } from '$lib/features/catalog';
	import {
		canReceivePhysicalStock,
		canPerformFrontlineDistribution
	} from '../../application/food-supplies/auth';
	import type { DistributionLog } from '../../domain/food-supplies';
	import RecipientSearchPicker from '../common/RecipientSearchPicker.svelte';
	import type { FrontlineRecipientSelection } from '../model/frontline-handover';
	import {
		isLoanReturnCandidate,
		isBulkClearedLoan,
		calculateLoanRemainingQty,
		getLoanStatusBadge
	} from '../model/loan-return';
	import CounterReturnDialog from './CounterReturnDialog.svelte';
	import NonPhysicalClearDialog from './NonPhysicalClearDialog.svelte';

	interface Props {
		shelterCode?: string;
	}

	let { shelterCode }: Props = $props();

	// Authoritative session context
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(shelterCode);
		} catch {
			return null;
		}
	});

	const canFrontline = $derived(authContext ? canPerformFrontlineDistribution(authContext) : false);
	const canReturnStock = $derived(authContext ? canReceivePhysicalStock(authContext) : false);

	// State
	let recipientSelection = $state<FrontlineRecipientSelection | null>(null);
	let selectedLogForReturn = $state<DistributionLog | null>(null);
	let returnDialogOpen = $state(false);

	let selectedLogForClear = $state<DistributionLog | null>(null);
	let clearDialogOpen = $state(false);

	let showHistory = $state(false);

	const recipientId = $derived(recipientSelection?.recipientId);

	// Query returnable logs for the selected recipient
	const recipientLoansQuery = useDistributionLogs(
		() => (recipientId ? { recipient_id: recipientId, is_returnable: true } : undefined),
		() => shelterCode,
		() => Boolean(recipientId)
	);

	const allRecipientLoans = $derived(recipientLoansQuery.data ?? []);
	const activeLoans = $derived(allRecipientLoans.filter(isLoanReturnCandidate));
	const historyLoans = $derived(allRecipientLoans.filter((l) => !isLoanReturnCandidate(l)));

	// Catalog and tickets query for resolving item names
	const ticketsQuery = useRequisitionTickets(undefined, () => shelterCode);
	const itemsQuery = useItemMasters();

	function resolveItemName(log: DistributionLog): string {
		// 1. Check ticket item line items
		const ticket = ticketsQuery.data?.find((t) => t._id === log.ticket_id);
		const ticketItem = ticket?.items.find((i) => i.item_id === log.item_id);
		if (ticketItem?.item_name) return ticketItem.item_name;

		// 2. Check catalog master
		const masterItem = itemsQuery.data?.find((i) => i._id === log.item_id);
		if (masterItem?.name) return masterItem.name;

		// 3. Fall back to clean ID
		return log.item_id.replace(/^item_master:|^item:/, '');
	}

	function handleOpenReturn(log: DistributionLog) {
		selectedLogForReturn = log;
		returnDialogOpen = true;
	}

	function handleOpenClear(log: DistributionLog) {
		selectedLogForClear = log;
		clearDialogOpen = true;
	}
</script>

<div class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
	<!-- Station Header -->
	<div
		class="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-2xs"
			>
				<RotateCcw class="h-6 w-6" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<span
						class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-900"
					>
						คืนสิ่งของยืม-คืน
					</span>
					<span class="text-2xs font-bold text-slate-500">
						Slice 5.5A / 5.5B / 5.5C Loan Returns
					</span>
				</div>
				<h3 class="text-base font-bold text-slate-900">
					สถานีรับคืนพัสดุและสิ่งของยืม-คืน (Loan Return Counter)
				</h3>
			</div>
		</div>

		<!-- Role Permission Indicator Badge -->
		<div>
			{#if canReturnStock}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 shadow-2xs"
				>
					<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
					สิทธิ์ตรวจรับคืนเข้าคลัง (WH/SC/SM/SA)
				</span>
			{:else}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 shadow-2xs"
				>
					<ShieldAlert class="h-3.5 w-3.5 text-amber-600" />
					โหมดตรวจสอบรายการ (ต้องการสิทธิ์คลังเพื่อรับคืน)
				</span>
			{/if}
		</div>
	</div>

	<!-- Role Permission Advisory Banner if only Frontline / Registrar -->
	{#if !canReturnStock && canFrontline}
		<div
			class="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950"
			role="note"
		>
			<Info class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
			<div>
				<p class="font-bold">ข้อมูลสิทธิ์การบันทึกตรวจรับของคืน (Counter Return Authorization)</p>
				<p class="mt-0.5 text-2xs text-amber-800">
					เจ้าหน้าที่ส่วนหน้า (REG) สามารถค้นหาและตรวจสอบประวัติการยืม และ<strong
						>บันทึกตัดจำหน่ายรายการ (สูญหาย/ยกเว้น) ได้</strong
					>
					แต่การบันทึกรับของคืนจริงเข้าคลังสินค้า (StockLedger reason='receive') ต้องดำเนินการโดยเจ้าหน้าที่คลัง
					(WH), ผู้ประสานงาน (SC), ผู้จัดการศูนย์ (SM) หรือผู้ดูแลระบบ (SA)
				</p>
			</div>
		</div>
	{/if}

	<!-- Recipient Search Picker Reused Component -->
	<RecipientSearchPicker bind:value={recipientSelection} />

	<!-- Loan List & Operations Surface -->
	{#if !recipientSelection}
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-12 text-center text-xs text-slate-500"
		>
			<Package class="mb-2 h-10 w-10 text-slate-300" />
			<p class="font-semibold text-slate-700">กรุณาระบุหรือสแกนบัตรผู้ประสบภัย</p>
			<p class="mt-0.5 text-2xs text-slate-400">
				ระบบจะค้นหารายการพัสดุและสิ่งของยืม-คืนทั้งหมดที่ผูกกับผู้ประสบภัยรายนี้
			</p>
		</div>
	{:else if recipientLoansQuery.isPending}
		<div
			class="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 py-12 text-xs text-slate-500"
		>
			<Loader class="h-4 w-4 animate-spin text-emerald-600" />
			<span>กำลังค้นหารายการสิ่งของยืม-คืน...</span>
		</div>
	{:else if recipientLoansQuery.isError}
		<div
			class="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800"
			role="alert"
		>
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
			<div class="flex-1">
				<p class="font-bold">ไม่สามารถดึงข้อมูลรายการยืมได้</p>
				<p class="text-2xs text-red-700">{(recipientLoansQuery.error as Error).message}</p>
				<button
					type="button"
					onclick={() => recipientLoansQuery.refetch()}
					class="mt-2 font-bold text-red-800 underline hover:text-red-900"
				>
					ลองใหม่
				</button>
			</div>
		</div>
	{:else if activeLoans.length === 0}
		<!-- No Active Loans State -->
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50/50 py-10 text-center"
		>
			<CheckCircle2 class="mb-2 h-10 w-10 text-emerald-500" />
			<p class="text-sm font-bold text-slate-800">ไม่มีรายการสิ่งของยืม-คืนที่ค้างส่ง</p>
			<p class="mt-0.5 text-xs text-slate-500">
				ผู้ประสบภัย <strong class="text-slate-700">{recipientSelection.label}</strong>
				ไม่มีรายการพัสดุที่ต้องส่งคืนในขณะนี้
			</p>
		</div>
	{:else}
		<!-- Active Loans Grid -->
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h4 class="text-xs font-bold tracking-wider text-slate-700 uppercase">
					รายการพัสดุยืม-คืนที่ต้องส่งคืน ({activeLoans.length} รายการ)
				</h4>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each activeLoans as loan (loan._id)}
					{@const remaining = calculateLoanRemainingQty(loan)}
					{@const statusBadge = getLoanStatusBadge(loan)}
					{@const itemName = resolveItemName(loan)}

					<div
						class="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition-all hover:border-slate-300"
					>
						<div class="space-y-2">
							<div class="flex items-start justify-between gap-2">
								<div>
									<h5 class="text-sm font-bold text-slate-900">{itemName}</h5>
									<p class="font-mono text-2xs text-slate-400">{loan._id}</p>
								</div>
								<span
									class="shrink-0 rounded-full border px-2 py-0.5 text-2xs font-bold {statusBadge.badgeClass}"
								>
									{statusBadge.label}
								</span>
							</div>

							<!-- Balances -->
							<div class="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-center text-2xs">
								<div>
									<span class="text-slate-400">ยืมไป</span>
									<p class="font-bold text-slate-700">{loan.qty}</p>
								</div>
								<div>
									<span class="text-slate-400">คืนแล้ว</span>
									<p class="font-bold text-slate-700">{loan.qty_returned ?? '0'}</p>
								</div>
								<div class="rounded-md bg-emerald-50 font-bold text-emerald-800">
									<span>คงค้าง</span>
									<p class="text-xs font-extrabold">{remaining}</p>
								</div>
							</div>

							<!-- Metadata -->
							<div class="flex items-center justify-between text-2xs text-slate-400">
								<span>วันที่ยืม: {new Date(loan.distributed_at).toLocaleDateString('th-TH')}</span>
								<span>ผู้จ่าย: {loan.distributed_by}</span>
							</div>
						</div>

						<!-- Action Buttons (Physical Return & Non-Physical Clear) -->
						<div class="mt-4 space-y-2 border-t border-slate-100 pt-3">
							<!-- Primary: Physical Counter Return -->
							<button
								type="button"
								onclick={() => handleOpenReturn(loan)}
								disabled={!canReturnStock}
								class="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-600 bg-emerald-600 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RotateCcw class="h-3.5 w-3.5" />
								<span>รับคืนของจริง (Counter Return)</span>
							</button>

							<!-- Secondary: Non-Physical Administrative Clear (Lost / Waived) -->
							<button
								type="button"
								onclick={() => handleOpenClear(loan)}
								disabled={!canFrontline}
								class="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<FileX class="h-3.5 w-3.5 text-slate-500" />
								<span>ตัดรายการโดยไม่มีของคืน (สูญหาย/ยกเว้น)</span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Loan History Section (Closed / Bulk-Cleared Loans) -->
	{#if historyLoans.length > 0}
		<div class="border-t border-slate-100 pt-4">
			<button
				type="button"
				onclick={() => (showHistory = !showHistory)}
				class="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
			>
				{#if showHistory}
					<ChevronUp class="h-4 w-4" />
				{:else}
					<ChevronDown class="h-4 w-4" />
				{/if}
				<span>ประวัติรายการยืมที่ปิดแล้ว ({historyLoans.length} รายการ)</span>
			</button>

			{#if showHistory}
				<div class="mt-3 space-y-2">
					{#each historyLoans as pastLoan (pastLoan._id)}
						{@const statusBadge = getLoanStatusBadge(pastLoan)}
						{@const isBulkCleared = isBulkClearedLoan(pastLoan)}
						<div
							class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs"
						>
							<div>
								<span class="font-bold text-slate-800">{resolveItemName(pastLoan)}</span>
								<span class="ml-2 font-mono text-2xs text-slate-400">{pastLoan._id}</span>
								{#if isBulkCleared}
									<p class="text-2xs text-purple-700">
										เคลียร์ผ่านจุดรวบรวม (Bulk Dropoff) · ห้ามรับคืนเข้าคลังซ้ำ (B1 Invariant)
									</p>
								{:else if pastLoan.status === 'lost'}
									<p class="text-2xs text-red-700">
										ตัดจำหน่ายสูญหาย · ไม่มีของคืนเข้าคลัง{pastLoan.notes
											? ` (${pastLoan.notes})`
											: ''}
									</p>
								{:else if pastLoan.status === 'waived'}
									<p class="text-2xs text-slate-600">
										ยกเว้นการคืนโดยเจ้าหน้าที่ · ไม่มีของคืนเข้าคลัง{pastLoan.notes
											? ` (${pastLoan.notes})`
											: ''}
									</p>
								{/if}
							</div>

							<div class="flex items-center gap-2">
								<span class="text-2xs text-slate-500">
									จำนวน {pastLoan.qty} ชิ้น (คืนแล้ว {pastLoan.qty_returned ?? '0'})
								</span>
								<span
									class="rounded-full border px-2 py-0.5 text-2xs font-bold {statusBadge.badgeClass}"
								>
									{statusBadge.label}
								</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Counter Return Modal Dialog (Slice 5.5B) -->
<CounterReturnDialog
	bind:open={returnDialogOpen}
	log={selectedLogForReturn}
	itemName={selectedLogForReturn ? resolveItemName(selectedLogForReturn) : ''}
	{shelterCode}
	{canReturnStock}
	onclose={() => {
		selectedLogForReturn = null;
	}}
/>

<!-- Non-Physical Clear Modal Dialog (Slice 5.5C) -->
<NonPhysicalClearDialog
	bind:open={clearDialogOpen}
	log={selectedLogForClear}
	itemName={selectedLogForClear ? resolveItemName(selectedLogForClear) : ''}
	{shelterCode}
	canClearLoan={canFrontline}
	onclose={() => {
		selectedLogForClear = null;
	}}
/>
