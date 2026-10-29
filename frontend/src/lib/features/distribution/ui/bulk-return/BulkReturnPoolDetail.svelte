<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Ban from '@lucide/svelte/icons/ban';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import { isShelterManager, isSystemAdmin, isWarehouseStaff } from '$lib/auth/roles';
	import { authStore } from '$lib/stores/auth.svelte';
	import { formatThaiDateTime } from '$lib/utils/date';
	import {
		createStableOperationId,
		resolveAuthenticatedAuthorContext,
		useBulkReturnPoolAppliedLoanRefs,
		useBulkReturnPoolClosedLoanRefs,
		useBulkReturnPoolMissedLoanRefs,
		useApplyMissedBulkReturnLoanRefs,
		useBulkReturnPoolTimeline,
		useBulkReturnSkippedDocs,
		useCancelBulkReturnPool,
		useReopenBulkReturnEntryLoans,
		useVoidBulkReturnEntry
	} from '../../application/queries';
	import type { BulkReturnEntry, BulkReturnPoolOverviewRow } from '../../domain/food-supplies';
	import { canReopenBulkReturnLoan } from '../../application/food-supplies/auth';
	import { formatDistributionError } from '../model/distribution-error';
	import {
		REOPEN_LOAN_DONE_NOTE,
		REOPEN_LOAN_ERROR,
		REOPEN_LOAN_REPLAYED_TOAST,
		REOPEN_LOAN_SKIPPED_TOAST,
		reopenLoanAction,
		reopenLoanSuccessToast,
		reopenedEntryIds,
		reopenedReasonByEntry,
		CLOSED_LOAN_WARNING_TESTID,
		MISSED_LOAN_ACTION,
		MISSED_LOAN_WARNING,
		MISSED_LOAN_WARNING_TESTID,
		SNAPSHOT_CONFLICT_WARNING,
		SNAPSHOT_CONFLICT_WARNING_TESTID,
		VOID_SNAPSHOT_CONFLICT_TOAST,
		groupMissedLoanRefsByEntry,
		snapshotConflictEntryIds,
		LATE_BADGE_CLASS,
		LATE_ENTRY_GUIDANCE,
		unresolvedRefsNotice,
		canCancelPool,
		canMoveEntry,
		canVoidEntry,
		closedLoanRefNotice,
		groupAppliedLoanRefsByEntry,
		groupClosedLoanRefsByEntry,
		getCancelPoolBlockedReason,
		getPoolStatusBadgeClass,
		getPoolStatusLabel,
		isPoolEditable,
		listMoveTargets,
		liveEntries,
		loanRefsSummary,
		poolStorageLabel,
		resolveItemDisplay,
		returnerDisplayName,
		type BulkReturnPoolRow,
		type PoolCatalogItem
	} from '../model/bulk-return-pool-v3';
	import { formatSkippedDocIds } from '../model/bulk-return-skipped-docs';
	import { ticketHref } from '../model/pool-url-state';
	import { liveSummaryRows, submittedSummaryRows } from '../model/bulk-return-lifecycle';
	import BulkReturnEntryReopenAction from './BulkReturnEntryReopenAction.svelte';
	import BulkReturnPoolReceiveRecord from './BulkReturnPoolReceiveRecord.svelte';
	import BulkReturnPoolTimeline from './BulkReturnPoolTimeline.svelte';
	import EditBulkReturnPoolHeaderDialog from './EditBulkReturnPoolHeaderDialog.svelte';
	import MoveBulkReturnEntryDialog from './MoveBulkReturnEntryDialog.svelte';
	import ReopenBulkReturnLoanDialog from './ReopenBulkReturnLoanDialog.svelte';

	interface Props {
		/** Live overview row of the selected pool (null = nothing selected, sheet closed). */
		row: BulkReturnPoolRow | null;
		/** All overview rows (move targets, duplicate-name advisory). */
		rows: readonly BulkReturnPoolRow[];
		catalog: readonly PoolCatalogItem[];
		/** Returner id -> display name (the board loads the rosters); falls back to a short id. */
		returnerNames?: ReadonlyMap<string, string>;
		shelterCode: string;
		/** canManageBulkReturnPool: edit header / cancel pool. */
		canManage: boolean;
		/** canWriteBulkReturnEntry: add / move / void entries. */
		canWriteEntry: boolean;
		onClose: () => void;
		/** Renders "รับของเข้ากอง" when provided (the board wires it to the add-entry dialog). */
		onAddEntry?: (poolId: string) => void;
		/** #660: submit / receive actions render in the header action row (board supplies a default). */
		lifecycleActions?: Snippet<[BulkReturnPoolOverviewRow]>;
	}

	let {
		row,
		rows,
		catalog,
		returnerNames,
		shelterCode,
		canManage,
		canWriteEntry,
		onClose,
		onAddEntry,
		lifecycleActions
	}: Props = $props();

	const voidMutation = useVoidBulkReturnEntry();
	const cancelMutation = useCancelBulkReturnPool();

	let editOpen = $state(false);
	let moveEntry = $state<BulkReturnEntry | null>(null);
	let reopenEntry = $state<BulkReturnEntry | null>(null);
	let voidTarget = $state<BulkReturnEntry | null>(null);
	let voidError = $state<string | null>(null);
	let cancelOpen = $state(false);
	let cancelError = $state<string | null>(null);
	// One ULID per cancel action; reused when the confirm is retried after a failure.
	let cancelUlid: string | null = null;

	// Loan drift: refs of this pool's live entries that were not applied to a closed / short loan.
	const closedRefsQuery = useBulkReturnPoolClosedLoanRefs(
		() => row?.pool._id ?? null,
		() => shelterCode
	);
	// Same predicate as requireWarehouseAccess (guards/auth.ts) on /back-office/distribution:
	// system_admin, shelter_manager or isWarehouseStaff (distribution_staff is excluded).
	const canOpenTicketPage = $derived.by(() => {
		const roles = authStore.user?.roles ?? [];
		return (
			isSystemAdmin(roles) ||
			isShelterManager(roles, shelterCode) ||
			isWarehouseStaff(roles, shelterCode)
		);
	});
	const closedRefsByEntry = $derived(groupClosedLoanRefsByEntry(closedRefsQuery.data ?? []));
	// Refs actually applied on loans (applied_bulk_entry_ids); undefined until first loaded.
	const appliedRefsQuery = useBulkReturnPoolAppliedLoanRefs(
		() => row?.pool._id ?? null,
		() => shelterCode
	);
	const appliedRefsByEntry = $derived(groupAppliedLoanRefsByEntry(appliedRefsQuery.data ?? []));
	// Snapshot entries of a submitted / received pool whose loans were never cut (CR-193 §34).
	const missedRefsQuery = useBulkReturnPoolMissedLoanRefs(
		() => row?.pool._id ?? null,
		() => shelterCode,
		() => row?.pool.status === 'SUBMITTED' || row?.pool.status === 'RECEIVED'
	);
	const missedRefsByEntry = $derived(groupMissedLoanRefsByEntry(missedRefsQuery.data ?? []));
	const applyMissedMutation = useApplyMissedBulkReturnLoanRefs();
	// Entries whose void / move was written after the submit snapshot (no effect; CR-193 §33).
	const conflictEntryIds = $derived(snapshotConflictEntryIds(row));

	// Malformed docs the pool reads leave out: the entries below may be incomplete until they are fixed.
	const skippedQuery = useBulkReturnSkippedDocs(undefined, () => shelterCode);
	const skippedDocs = $derived(skippedQuery.data ?? []);
	const skippedIds = $derived(formatSkippedDocIds(skippedDocs));

	// Chronological history of this pool (nested under the overview key, so writes refresh it).
	const timelineQuery = useBulkReturnPoolTimeline(
		() => row?.pool._id ?? null,
		() => shelterCode
	);
	// Fail closed: any problem resolving the session context hides the reopen action.
	const canReopen = $derived.by(() => {
		try {
			return canReopenBulkReturnLoan(resolveAuthenticatedAuthorContext(shelterCode));
		} catch {
			return false;
		}
	});
	const reopenedIds = $derived(reopenedEntryIds(timelineQuery.data?.events));
	// Stored reason of each existing reopen doc: resuming replays with it (no new reason asked).
	const reopenedReasons = $derived(reopenedReasonByEntry(timelineQuery.data?.events));
	const resumeMutation = useReopenBulkReturnEntryLoans();
	const poolNameById = $derived(new Map(rows.map((r) => [r.pool._id, r.pool.name])));

	const entries = $derived(row ? liveEntries(row) : []);
	const moveTargets = $derived(row ? listMoveTargets(rows, row.pool._id) : []);
	const editable = $derived(row ? isPoolEditable(row.pool) : false);
	const lateCount = $derived(row?.late_entries.length ?? 0);
	const cancelBlockedReason = $derived(row ? getCancelPoolBlockedReason(row) : null);
	// Once submitted the items section shows the immutable submit snapshot; `row.items` is the live
	// fold and would include late entries.
	const showSnapshot = $derived(
		row ? row.pool.status === 'SUBMITTED' || row.pool.status === 'RECEIVED' : false
	);
	const summaryRows = $derived(
		row
			? showSnapshot
				? submittedSummaryRows(row.pool, catalog)
				: liveSummaryRows(row, catalog)
			: []
	);

	function handleSheetOpenChange(next: boolean) {
		if (!next) onClose();
	}

	async function confirmVoid() {
		if (!voidTarget) return;
		voidError = null;
		try {
			const result = await voidMutation.mutateAsync({
				input: { entry_id: voidTarget._id },
				shelterCode
			});
			const reverted = result.loansReverted.length;
			if (result.snapshot_conflict) {
				toast.warning(VOID_SNAPSHOT_CONFLICT_TOAST);
			} else {
				toast.success(
					reverted > 0
						? `ยกเลิกรายการแล้ว คืนสถานะยอดยืม ${reverted} รายการเรียบร้อย`
						: 'ยกเลิกรายการแล้ว (รายการนี้ไม่ได้ตัดยอดยืม จึงไม่มียอดยืมต้องคืนสถานะ)'
				);
			}
			voidTarget = null;
		} catch (err) {
			const message = formatDistributionError(err, 'ยกเลิกรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			voidError = message;
			toast.error(message);
		}
	}

	async function applyMissedLoans(entryId: string) {
		if (!row) return;
		try {
			const result = await applyMissedMutation.mutateAsync({
				input: { entry_id: entryId, pool_id: row.pool._id },
				shelterCode
			});
			const applied = result.loansApplied.length;
			if (applied === 0 && result.loansSkipped.length > 0) {
				toast.warning('ยอดยืมถูกปิดไปแล้ว ตัดเพิ่มไม่ได้');
			} else {
				toast.success(`ตัดยอดยืมแล้ว ${applied} รายการ`);
			}
		} catch (err) {
			toast.error(formatDistributionError(err, 'ตัดยอดยืมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
		}
	}

	async function resumeReopen(entryId: string, storedReason: string) {
		try {
			const result = await resumeMutation.mutateAsync({
				input: { entry_id: entryId, reason: storedReason },
				shelterCode
			});
			const reopened = result.loansReopened.length;
			if (result.replayed && reopened === 0) {
				toast.info(REOPEN_LOAN_REPLAYED_TOAST);
			} else {
				toast.success(reopenLoanSuccessToast(reopened));
			}
			if (result.loansSkipped.length > 0) toast.warning(REOPEN_LOAN_SKIPPED_TOAST);
		} catch (err) {
			toast.error(formatDistributionError(err, REOPEN_LOAN_ERROR, { poolContext: 'reopen' }));
		}
	}

	async function confirmCancelPool() {
		if (!row) return;
		cancelError = null;
		cancelUlid ??= createStableOperationId();
		try {
			await cancelMutation.mutateAsync({
				poolId: row.pool._id,
				operationUlid: cancelUlid,
				shelterCode
			});
			cancelUlid = null;
			toast.success('ยกเลิกกองเรียบร้อยแล้ว');
			cancelOpen = false;
			onClose();
		} catch (err) {
			const message = formatDistributionError(err, 'ยกเลิกกองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			cancelError = message;
			toast.error(message);
		}
	}
</script>

<Sheet.Root open={row !== null} onOpenChange={handleSheetOpenChange}>
	<Sheet.Content side="right" class="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
		{#if row}
			{@const pool = row.pool}
			<div class="space-y-3 border-b border-slate-100 bg-slate-50 px-5 pt-6 pr-14 pb-4">
				<Sheet.Header class="p-0">
					<Sheet.Title class="text-xl font-bold break-words text-slate-900">
						{pool.name}
					</Sheet.Title>
					<Sheet.Description class="sr-only">รายละเอียดกองรับคืน {pool.name}</Sheet.Description>
				</Sheet.Header>

				<div class="flex flex-wrap items-center gap-2">
					<span
						class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {getPoolStatusBadgeClass(
							pool.status
						)}"
					>
						{getPoolStatusLabel(pool.status)}
					</span>
					{#if lateCount > 0}
						<span
							class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold {LATE_BADGE_CLASS}"
						>
							<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
							ค้าง <span class="tabular-nums">{lateCount}</span>
						</span>
					{/if}
				</div>

				{#if row.unresolved_refs.length > 0}
					<div
						role="status"
						class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
					>
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
						<p>{unresolvedRefsNotice(row.unresolved_refs.length)}</p>
					</div>
				{/if}

				{#if skippedDocs.length > 0}
					<div
						role="status"
						data-testid="bulk-return-skipped-docs"
						class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
					>
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
						<p class="break-words">
							พบเอกสารกองรับคืนที่ข้อมูลไม่ถูกต้องในศูนย์นี้ <span class="tabular-nums"
								>{skippedDocs.length}</span
							>
							รายการ ระบบข้ามไว้ไม่แสดง ถ้าเป็นเอกสารของกองนี้ การย้าย ยกเลิกรายการ และส่งเข้าคลังจะถูกระงับ
							— ติดต่อผู้ดูแลระบบ
							{#if skippedIds}({skippedIds}){/if}
						</p>
					</div>
				{/if}

				<dl class="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
					<dt class="flex items-center gap-1.5 text-slate-500">
						<MapPin class="h-4 w-4" aria-hidden="true" />จุดที่ตั้ง
					</dt>
					<dd class="font-medium text-slate-900">{poolStorageLabel(pool)}</dd>
					<dt class="text-slate-500">หมายเหตุ</dt>
					<dd class="break-words text-slate-900">{pool.notes ?? '—'}</dd>
					<dt class="text-slate-500">เปิดกองโดย</dt>
					<dd class="text-slate-900">
						{pool.created_by}
						<span class="text-slate-500 tabular-nums">· {formatThaiDateTime(pool.created_at)}</span>
					</dd>
				</dl>

				<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
					{#if onAddEntry && canWriteEntry && editable}
						<Button
							type="button"
							onclick={() => onAddEntry(pool._id)}
							class="min-h-11 w-full gap-2 sm:w-auto"
						>
							<PackagePlus class="h-4 w-4" aria-hidden="true" />
							รับของเข้ากอง
						</Button>
					{/if}
					{#if canManage && editable}
						<Button
							type="button"
							variant="outline"
							onclick={() => (editOpen = true)}
							class="min-h-11 w-full gap-2 sm:w-auto"
						>
							<Pencil class="h-4 w-4" aria-hidden="true" />
							แก้ไขข้อมูลกอง
						</Button>
					{/if}
					<!-- #660: submit / receive actions (board default: BulkReturnPoolLifecycleActions) -->
					{@render lifecycleActions?.(row)}
				</div>
			</div>

			<div class="space-y-6 p-5">
				<section aria-labelledby="pool-items-heading" class="space-y-2">
					<h3 id="pool-items-heading" class="text-base font-semibold text-slate-800">
						{showSnapshot ? 'ยอดที่ส่งเข้าคลัง' : 'สรุปรายการสินค้าในกอง'}
					</h3>
					{#if showSnapshot && pool.submitted_at}
						<p class="text-xs text-slate-500">
							ส่งเมื่อ <span class="tabular-nums">{formatThaiDateTime(pool.submitted_at)}</span>
						</p>
					{/if}
					{#if summaryRows.length === 0}
						<p class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
							ยังไม่มีสินค้าในกองนี้
						</p>
					{:else}
						<ul class="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white">
							{#each summaryRows as summary (summary.item_id)}
								<li class="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-sm">
									<span class="font-medium break-words text-slate-900">{summary.name}</span>
									<span class="shrink-0 font-semibold text-slate-900 tabular-nums">
										{summary.qty}
										{summary.unit}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#if pool.status === 'RECEIVED'}
					<BulkReturnPoolReceiveRecord {row} {catalog} />
				{/if}

				<section aria-labelledby="pool-entries-heading" class="space-y-2">
					<h3 id="pool-entries-heading" class="text-base font-semibold text-slate-800">
						รายการที่รับเข้ากอง
						<span class="text-sm font-normal text-slate-500 tabular-nums">
							({entries.length})
						</span>
					</h3>
					{#if entries.length === 0}
						<p class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
							ยังไม่มีรายการในกองนี้
						</p>
					{:else}
						<ul class="space-y-3">
							{#each entries as live (live.entry._id)}
								{@const entry = live.entry}
								{@const reopenAction = reopenLoanAction({
									pool,
									entryId: entry._id,
									appliedRefs: appliedRefsByEntry.get(entry._id) ?? [],
									canReopen,
									reopened: reopenedIds.has(entry._id),
									reopenedKnown: timelineQuery.isSuccess
								})}
								{@const resumeReason = reopenAction.showButton
									? reopenedReasons.get(entry._id)
									: undefined}
								{@const item = resolveItemDisplay(entry.item_id, catalog)}
								{@const closedRefs = closedRefsByEntry.get(entry._id) ?? []}
								{@const missedRefs = missedRefsByEntry.get(entry._id) ?? []}
								<li
									class="space-y-2 rounded-xl border p-3.5 shadow-2xs {live.late
										? 'border-amber-200 bg-amber-50/40'
										: 'border-slate-200/80 bg-white'}"
								>
									<div class="flex flex-wrap items-baseline justify-between gap-2">
										<span class="font-semibold break-words text-slate-900">{item.name}</span>
										<span class="font-semibold text-slate-900 tabular-nums">
											{entry.qty}
											{item.unit}
										</span>
									</div>
									<div class="space-y-0.5 text-sm text-slate-600">
										<p>
											ผู้คืน: <span class="font-medium text-slate-800"
												>{returnerDisplayName(entry, returnerNames)}</span
											>
										</p>
										{#if appliedRefsQuery.data}
											<p>{loanRefsSummary(appliedRefsByEntry.get(entry._id) ?? [], item.unit)}</p>
										{/if}
										<p class="text-xs text-slate-500">
											บันทึกโดย {entry.created_by} ·
											<span class="tabular-nums">{formatThaiDateTime(entry.created_at)}</span>
										</p>
										{#if entry.notes}
											<p class="text-xs break-words text-slate-500">หมายเหตุ: {entry.notes}</p>
										{/if}
										{#if reopenedIds.has(entry._id)}
											<p class="text-xs font-medium text-red-800">{REOPEN_LOAN_DONE_NOTE}</p>
										{/if}
									</div>

									{#if live.late}
										<div
											class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
										>
											<AlertTriangle
												class="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
												aria-hidden="true"
											/>
											<p>
												<span class="font-semibold">ค้าง</span>
												รายการนี้เข้ามาหลังกองปิดรับแล้ว จึงไม่ถูกนับในยอดที่ส่ง กรุณา{LATE_ENTRY_GUIDANCE}
											</p>
										</div>
									{/if}

									{#if closedRefs.length > 0}
										<div
											role="status"
											data-testid={CLOSED_LOAN_WARNING_TESTID}
											class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
										>
											<AlertTriangle
												class="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
												aria-hidden="true"
											/>
											<div class="space-y-1">
												{#each closedRefs as ref (ref.distribution_log_id)}
													<p>
														{closedLoanRefNotice(ref, item.unit)}
														{#if ref.ticket_id && canOpenTicketPage}
															<a
																href={resolve(ticketHref(ref.ticket_id) as '/')}
																class="font-medium underline underline-offset-2"
															>
																ดูใบเบิกของรายการยืมนี้
															</a>
														{/if}
													</p>
												{/each}
											</div>
										</div>
									{/if}

									{#if conflictEntryIds.has(entry._id)}
										<div
											role="status"
											data-testid={SNAPSHOT_CONFLICT_WARNING_TESTID}
											class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
										>
											<AlertTriangle
												class="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
												aria-hidden="true"
											/>
											<p>{SNAPSHOT_CONFLICT_WARNING}</p>
										</div>
									{/if}

									{#if missedRefs.length > 0}
										<div
											role="status"
											data-testid={MISSED_LOAN_WARNING_TESTID}
											class="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
										>
											<div class="flex items-start gap-2">
												<AlertTriangle
													class="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
													aria-hidden="true"
												/>
												<p>{MISSED_LOAN_WARNING}</p>
											</div>
											{#if canWriteEntry}
												<Button
													type="button"
													variant="outline"
													disabled={applyMissedMutation.isPending}
													onclick={() => applyMissedLoans(entry._id)}
													class="min-h-11 w-full gap-2 sm:w-auto"
												>
													{#if applyMissedMutation.isPending}
														<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
													{/if}
													{MISSED_LOAN_ACTION}
												</Button>
											{/if}
										</div>
									{/if}

									<BulkReturnEntryReopenAction
										showButton={reopenAction.showButton}
										blockedNotice={reopenAction.blockedNotice}
										resume={resumeReason !== undefined}
										pending={resumeMutation.isPending &&
											resumeMutation.variables?.input.entry_id === entry._id}
										onReopen={() =>
											resumeReason !== undefined
												? void resumeReopen(entry._id, resumeReason)
												: (reopenEntry = entry)}
									/>

									{#if canWriteEntry}
										{@const showMove = canMoveEntry(row, entry._id)}
										{@const showVoid = canVoidEntry(row)}
										{#if showMove || showVoid}
											<div class="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
												{#if showMove}
													<Button
														type="button"
														variant="outline"
														onclick={() => (moveEntry = entry)}
														class="min-h-11 w-full gap-2 sm:w-auto"
													>
														<ArrowRightLeft class="h-4 w-4" aria-hidden="true" />
														ย้ายไปกองอื่น
													</Button>
												{/if}
												{#if showVoid}
													<Button
														type="button"
														variant="outline"
														onclick={() => {
															voidError = null;
															voidTarget = entry;
														}}
														class="min-h-11 w-full gap-2 border-red-200 text-red-800 hover:bg-red-50 sm:w-auto"
													>
														<Undo2 class="h-4 w-4" aria-hidden="true" />
														ยกเลิกรายการ
													</Button>
												{/if}
											</div>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<BulkReturnPoolTimeline
					events={timelineQuery.data?.events}
					{catalog}
					{returnerNames}
					{poolNameById}
					isLoading={timelineQuery.isPending && timelineQuery.fetchStatus !== 'idle'}
					isError={timelineQuery.isError}
					skipped={timelineQuery.data?.skipped}
					shelterSkipped={skippedQuery.data}
				/>

				{#if canManage && pool.status === 'OPEN'}
					<section
						aria-labelledby="pool-cancel-heading"
						class="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-4"
					>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="space-y-1">
								<h3 id="pool-cancel-heading" class="text-base font-semibold text-slate-800">
									ยกเลิกกอง
								</h3>
								<p class="text-sm text-slate-600">
									ยกเลิกได้เมื่อไม่มีรายการเหลืออยู่ในกอง กองที่ยกเลิกแล้วจะเปิดรับของอีกไม่ได้
								</p>
							</div>
							<Button
								type="button"
								variant="destructive"
								disabled={!canCancelPool(row)}
								aria-describedby={cancelBlockedReason ? 'cancel-pool-reason' : undefined}
								onclick={() => {
									cancelError = null;
									cancelOpen = true;
								}}
								class="min-h-11 w-full shrink-0 gap-2 sm:w-auto"
							>
								<Ban class="h-4 w-4" aria-hidden="true" />
								ยกเลิกกอง
							</Button>
						</div>
						{#if cancelBlockedReason}
							<p class="flex items-start gap-2 text-sm font-medium text-slate-800 sm:justify-end">
								<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
								<span id="cancel-pool-reason">{cancelBlockedReason}</span>
							</p>
						{/if}
					</section>
				{/if}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

{#if row && editOpen}
	<EditBulkReturnPoolHeaderDialog
		pool={row.pool}
		{shelterCode}
		{rows}
		onClose={() => (editOpen = false)}
	/>
{/if}

{#if row && moveEntry}
	<MoveBulkReturnEntryDialog
		entry={moveEntry}
		item={resolveItemDisplay(moveEntry.item_id, catalog)}
		fromPoolName={row.pool.name}
		late={entries.find((live) => live.entry._id === moveEntry?._id)?.late ?? false}
		targets={moveTargets}
		{shelterCode}
		onClose={() => (moveEntry = null)}
	/>
{/if}

{#if row && reopenEntry}
	<ReopenBulkReturnLoanDialog
		entry={reopenEntry}
		item={resolveItemDisplay(reopenEntry.item_id, catalog)}
		returnerName={returnerDisplayName(reopenEntry, returnerNames)}
		{shelterCode}
		onClose={() => (reopenEntry = null)}
	/>
{/if}

<AlertDialog.Root
	open={voidTarget !== null}
	onOpenChange={(next) => {
		if (!next && !voidMutation.isPending) voidTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการยกเลิกรายการ</AlertDialog.Title>
			<AlertDialog.Description>
				{#if voidTarget}
					{@const item = resolveItemDisplay(voidTarget.item_id, catalog)}
					ยกเลิก {item.name}
					{voidTarget.qty}
					{item.unit} ออกจากกอง ยอดยืมที่เคยตัดไว้จากรายการนี้ (ถ้ามี) จะถูกคืนสถานะเป็นยังไม่คืน
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if voidError}
			<p role="alert" class="text-sm font-medium text-red-700">{voidError}</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={voidMutation.isPending} class="min-h-11">
				ไม่ยกเลิก
			</AlertDialog.Cancel>
			<Button
				type="button"
				variant="destructive"
				disabled={voidMutation.isPending}
				onclick={confirmVoid}
				class="min-h-11 gap-2"
			>
				{#if voidMutation.isPending}
					<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
				{/if}
				ยืนยันยกเลิกรายการ
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
	bind:open={cancelOpen}
	onOpenChange={(next) => {
		if (!next) cancelUlid = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการยกเลิกกอง</AlertDialog.Title>
			<AlertDialog.Description>
				ยกเลิกกอง "{row?.pool.name ?? ''}" กองที่ยกเลิกแล้วจะเปิดรับของอีกไม่ได้
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if cancelError}
			<p role="alert" class="text-sm font-medium text-red-700">{cancelError}</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={cancelMutation.isPending} class="min-h-11">
				ไม่ยกเลิก
			</AlertDialog.Cancel>
			<Button
				type="button"
				variant="destructive"
				disabled={cancelMutation.isPending}
				onclick={confirmCancelPool}
				class="min-h-11 gap-2"
			>
				{#if cancelMutation.isPending}
					<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
				{/if}
				ยืนยันยกเลิกกอง
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
