import { addQty } from '$lib/utils/qty';
import {
	canAppendToPool,
	canReopenEntryLoans,
	isPoolNameTakenAmongOpen,
	type BulkReturnEntry,
	type AppliedBulkReturnLoanRef,
	type ClosedBulkReturnLoanRef,
	type MissedBulkReturnLoanRef,
	type BulkReturnPoolOverviewRow,
	type BulkReturnPoolV3,
	type BulkReturnPoolV3Status
} from '../../domain/food-supplies';
import type { UpdateBulkReturnPoolHeaderPatch } from '../../application/food-supplies/bulk-return-pool-v3-lifecycle';
import { BULK_RETURN_REOPEN_BLOCKED_COPY } from './bulk-return-copy';

/**
 * #659 — pure view-model helpers for the bulk return pool v3 board (list / detail / dialogs).
 * No Svelte, no I/O.
 */

export const BULK_RETURN_POOL_NAME_MAX_LENGTH = 80;

export const UNSPECIFIED_STORAGE_LABEL = 'ไม่ระบุ';
export const UNSPECIFIED_RETURNER_LABEL = 'ไม่ระบุผู้คืน';
export const NOT_EMPTY_CANCEL_REASON =
	'ยกเลิกไม่ได้เนื่องจากยังมีรายการค้างอยู่ในกอง — ย้ายหรือยกเลิกรายการให้หมดก่อน';
export const LATE_ENTRY_GUIDANCE = 'ย้ายไปกองอื่นที่ยังเปิดอยู่';
export const UNRESOLVED_REFS_HINT =
	'มีข้อมูลการย้าย/ยกเลิกที่ยังซิงก์มาไม่ครบ ยอดในกองอาจยังไม่ครบ';
export function unresolvedRefsNotice(count: number): string {
	return `รอซิงก์ข้อมูล: มีข้อมูลการย้าย/ยกเลิก ${count} รายการที่ยังซิงก์มาไม่ครบ ยอดในกองอาจยังไม่ครบ ระบบจะแสดงผลเมื่อข้อมูลซิงก์ครบ`;
}
/** Loan-drift warning (read-time): the loan was closed before the item reached the pool. */
export const CLOSED_LOAN_WARNING_TEXT =
	'ยอดยืมใบนี้ถูกปิดไปก่อนที่ของจะเข้ากอง — โปรดตรวจสอบว่าปิดถูกต้องหรือไม่';
export const MISSING_LOAN_WARNING_TEXT =
	'ไม่พบรายการยืมที่อ้างถึง จึงไม่ได้ตัดยอดยืม — โปรดตรวจสอบว่ารายการยืมถูกต้องหรือไม่';
export const CLOSED_LOAN_WARNING_TESTID = 'bulk-return-entry-closed-loan-warning';
/** CR-193 §33: a void / move written after the submit snapshot had no effect. */
export const SNAPSHOT_CONFLICT_WARNING =
	'ยกเลิก/ย้ายรายการนี้หลังกองถูกส่งเข้าคลังแล้ว จึงไม่มีผล — โปรดตรวจสอบของจริงกับคลัง';
export const SNAPSHOT_CONFLICT_WARNING_TESTID = 'bulk-return-snapshot-conflict-warning';
export const VOID_SNAPSHOT_CONFLICT_TOAST =
	'กองถูกส่งเข้าคลังก่อนการยกเลิกจะมีผล รายการนี้ยังนับในกอง — โปรดตรวจสอบกับคลัง';
export const MOVE_SNAPSHOT_CONFLICT_TOAST =
	'กองต้นทางถูกส่งเข้าคลังก่อนการย้ายจะมีผล รายการนี้ยังอยู่ในกองเดิม — โปรดตรวจสอบกับคลัง';
/** CR-193 §34: a submitted pool's entry whose loans were never cut. */
export const MISSED_LOAN_WARNING = 'ยอดยืมของรายการนี้ยังไม่ถูกตัด';
export const MISSED_LOAN_WARNING_TESTID = 'bulk-return-missed-loan-warning';
export const MISSED_LOAN_ACTION = 'ตัดยอดยืมที่ค้าง';
/** CR-193 §35: reopen the loans of one entry of a closed pool. */
export const REOPEN_LOAN_ACTION = 'เปิดยอดยืมกลับ';
export const REOPEN_LOAN_DESCRIPTION =
	'ใช้เมื่อพบภายหลังว่าของรายการนี้ไม่ได้คืนจริง ระบบจะเปิดยอดยืมของผู้คืนกลับเป็นค้าง โดยไม่แก้ยอดกองหรือยอดคลัง (ถ้าต้องแก้ยอดคลัง ให้ทำแถวปรับยอดที่หน้าคลัง)';
export const REOPEN_LOAN_REASON_LABEL = 'เหตุผล';
export const REOPEN_LOAN_CONFIRM = 'ยืนยันเปิดยอดยืมกลับ';
export const REOPEN_LOAN_ERROR = 'เปิดยอดยืมกลับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
export const REOPEN_LOAN_REPLAYED_TOAST = 'รายการนี้ถูกเปิดยอดยืมกลับไปแล้ว';
export const REOPEN_LOAN_SKIPPED_TOAST = 'บางรายการยืมถูกปิดไปแล้ว จึงเปิดกลับไม่ได้';
export const REOPEN_LOAN_DONE_NOTE = 'เปิดยอดยืมกลับแล้ว';
export function reopenLoanSuccessToast(count: number): string {
	return `เปิดยอดยืมกลับแล้ว ${count} รายการ`;
}
export const POOL_LOCKED_REASON = 'กองนี้กำลังถูกดำเนินการ กรุณารอสักครู่แล้วรีเฟรช';

export type BulkReturnPoolRow = BulkReturnPoolOverviewRow;
export type BulkReturnPoolEntryRow = BulkReturnPoolOverviewRow['entries'][number];

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const BULK_RETURN_POOL_V3_STATUS_LABELS: Record<BulkReturnPoolV3Status, string> = {
	OPEN: 'เปิดรับ',
	SUBMITTED: 'รอตรวจสอบ',
	RECEIVED: 'ตรวจรับแล้ว',
	CANCELLED: 'ยกเลิก'
};

/** Full-perimeter tinted badge classes (never color-only: the badge always carries the label). */
export const BULK_RETURN_POOL_V3_STATUS_BADGE_CLASSES: Record<BulkReturnPoolV3Status, string> = {
	OPEN: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
	SUBMITTED: 'border border-sky-200 bg-sky-50 text-sky-900',
	RECEIVED: 'border border-slate-300 bg-slate-100 text-slate-900',
	CANCELLED: 'border border-slate-200 bg-white text-slate-500'
};

export const LATE_BADGE_CLASS = 'border border-amber-200 bg-amber-50 text-amber-900';

export function getPoolStatusLabel(status: BulkReturnPoolV3Status): string {
	return BULK_RETURN_POOL_V3_STATUS_LABELS[status];
}

export function getPoolStatusBadgeClass(status: BulkReturnPoolV3Status): string {
	return BULK_RETURN_POOL_V3_STATUS_BADGE_CLASSES[status];
}

const STATUS_ORDER: Record<BulkReturnPoolV3Status, number> = {
	OPEN: 0,
	SUBMITTED: 1,
	RECEIVED: 2,
	CANCELLED: 3
};

// ---------------------------------------------------------------------------
// List filtering / sorting / view state
// ---------------------------------------------------------------------------

/** RECEIVED pools older than this many days are hidden by default (board toggle shows them). */
export const RECEIVED_POOL_HIDE_AFTER_DAYS = 7;

export const POOL_STORAGE_UNSPECIFIED = 'unspecified';

/** Status chips on the board; CANCELLED stays governed by the "show cancelled" toggle. */
export type PoolStatusFilter = 'all' | 'OPEN' | 'SUBMITTED' | 'RECEIVED';

export const POOL_STATUS_FILTER_VALUES: readonly PoolStatusFilter[] = [
	'all',
	'OPEN',
	'SUBMITTED',
	'RECEIVED'
];

export const POOL_STATUS_FILTER_ALL_LABEL = 'ทั้งหมด';

export function getPoolStatusFilterLabel(value: PoolStatusFilter): string {
	return value === 'all' ? POOL_STATUS_FILTER_ALL_LABEL : getPoolStatusLabel(value);
}

export interface PoolRowFilter {
	search?: string;
	showCancelled?: boolean;
	status?: PoolStatusFilter;
	/** Keep pools whose `items` contain this item id. */
	itemId?: string;
	/** Pool's `location_storage_point_id`; `'unspecified'` = pools without a storage point. */
	storagePointId?: string;
	/** Keep pools with late entries, unresolved refs or closed-loan-mid-flight refs. */
	needsAttention?: boolean;
	/**
	 * Returner id -> display name. When given, `search` also matches the returner name of any
	 * non-voided entry of the pool.
	 */
	returnerNames?: ReadonlyMap<string, string>;
	/** RECEIVED pools with `received_at` strictly before this instant are hidden. */
	hideReceivedBefore?: Date;
}

/** Cutoff for hiding old RECEIVED pools: `now` minus `RECEIVED_POOL_HIDE_AFTER_DAYS` days. */
export function receivedHideCutoff(now: Date = new Date()): Date {
	return new Date(now.getTime() - RECEIVED_POOL_HIDE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

/** Visibility governed by the two toggles (cancelled, old received). Pools without received_at stay. */
function passesToggles(
	row: BulkReturnPoolRow,
	filter: Pick<PoolRowFilter, 'showCancelled' | 'hideReceivedBefore'>
): boolean {
	const { status, received_at } = row.pool;
	if (status === 'CANCELLED' && !filter.showCancelled) return false;
	if (status === 'RECEIVED' && filter.hideReceivedBefore && received_at) {
		const receivedMs = Date.parse(received_at);
		if (!Number.isNaN(receivedMs) && receivedMs < filter.hideReceivedBefore.getTime()) {
			return false;
		}
	}
	return true;
}

/** True when any non-toggle filter narrows the list (used for the "ล้างตัวกรอง" button). */
export function hasActivePoolFilters(filter: PoolRowFilter): boolean {
	return (
		(filter.search ?? '').trim().length > 0 ||
		(filter.status !== undefined && filter.status !== 'all') ||
		Boolean(filter.itemId) ||
		Boolean(filter.storagePointId) ||
		Boolean(filter.needsAttention)
	);
}

/**
 * Per-status counts for the chips. Counted AFTER the cancelled toggle and received-age hiding
 * (so a chip never promises rows the toggles hide) but BEFORE search / item / storage / attention
 * / status filters (so chips stay stable while the user narrows other dimensions). `all` is the
 * total of rows passing the toggles.
 */
export function poolStatusCounts(
	rows: readonly BulkReturnPoolRow[],
	filter: Pick<PoolRowFilter, 'showCancelled' | 'hideReceivedBefore'> = {}
): Record<PoolStatusFilter, number> {
	const counts: Record<PoolStatusFilter, number> = { all: 0, OPEN: 0, SUBMITTED: 0, RECEIVED: 0 };
	for (const row of rows) {
		if (!passesToggles(row, filter)) continue;
		counts.all += 1;
		if (row.pool.status !== 'CANCELLED') counts[row.pool.status] += 1;
	}
	return counts;
}

/** Distinct item ids present across the rows (first-seen order). */
export function poolItemIds(rows: readonly BulkReturnPoolRow[]): string[] {
	const seen = new Set<string>();
	for (const row of rows) for (const item of row.items) seen.add(item.item_id);
	return [...seen];
}

export interface PoolStorageOption {
	/** Storage point id, or `'unspecified'`. */
	value: string;
	label: string;
}

/**
 * Distinct storage points across the rows (label = zone, falling back to the id), plus
 * `unspecified` when some pool has no point. Sorted by label (Thai collation).
 */
export function poolStorageOptions(rows: readonly BulkReturnPoolRow[]): PoolStorageOption[] {
	const byValue = new Map<string, string>();
	for (const { pool } of rows) {
		const id = pool.location_storage_point_id;
		if (!id) {
			byValue.set(POOL_STORAGE_UNSPECIFIED, UNSPECIFIED_STORAGE_LABEL);
			continue;
		}
		const zone = pool.location_storage_zone?.trim();
		if (zone || !byValue.has(id)) byValue.set(id, zone || id);
	}
	return [...byValue.entries()]
		.map(([value, label]) => ({ value, label }))
		.sort((a, b) => a.label.localeCompare(b.label, 'th'));
}

/**
 * Name search (case-insensitive, trimmed), status / item / storage / needs-attention filters;
 * CANCELLED hidden unless `showCancelled`, old RECEIVED hidden when `hideReceivedBefore` is set.
 * Sorted OPEN, SUBMITTED, RECEIVED, CANCELLED; newest `created_at` first within a status (id as
 * tie-break).
 */
export function filterPoolRows(
	rows: readonly BulkReturnPoolRow[],
	filter: PoolRowFilter = {}
): BulkReturnPoolRow[] {
	const needle = (filter.search ?? '').trim().toLocaleLowerCase();
	return rows
		.filter((row) => {
			if (!passesToggles(row, filter)) return false;
			if (filter.status && filter.status !== 'all' && row.pool.status !== filter.status) {
				return false;
			}
			if (filter.itemId && !row.items.some((item) => item.item_id === filter.itemId)) return false;
			if (filter.storagePointId) {
				const pointId = row.pool.location_storage_point_id;
				if (filter.storagePointId === POOL_STORAGE_UNSPECIFIED) {
					if (pointId) return false;
				} else if (pointId !== filter.storagePointId) {
					return false;
				}
			}
			if (
				filter.needsAttention &&
				row.late_entries.length === 0 &&
				row.unresolved_refs.length === 0 &&
				row.closed_loan_refs.length === 0 &&
				row.snapshot_conflicts.length === 0
			) {
				return false;
			}
			if (!needle) return true;
			if (row.pool.name.toLocaleLowerCase().includes(needle)) return true;
			return row.entries.some(
				(r) =>
					!r.voided &&
					returnerDisplayName(r.entry, filter.returnerNames).toLocaleLowerCase().includes(needle)
			);
		})
		.sort((a, b) => {
			const byStatus = STATUS_ORDER[a.pool.status] - STATUS_ORDER[b.pool.status];
			if (byStatus !== 0) return byStatus;
			if (a.pool.created_at !== b.pool.created_at) {
				return a.pool.created_at < b.pool.created_at ? 1 : -1;
			}
			return a.pool._id < b.pool._id ? 1 : a.pool._id > b.pool._id ? -1 : 0;
		});
}

export type BulkReturnPoolBoardViewState = 'loading' | 'error' | 'empty' | 'search_empty' | 'ready';

export function getPoolBoardViewState(
	isLoading: boolean,
	isError: boolean,
	totalRowCount: number,
	visibleRowCount: number
): BulkReturnPoolBoardViewState {
	if (isLoading) return 'loading';
	if (isError) return 'error';
	// `totalRowCount` is the rows before search/status/item/storage/attention filters, so any
	// active filter that leaves nothing yields `search_empty`.
	if (totalRowCount === 0) return 'empty';
	if (visibleRowCount === 0) return 'search_empty';
	return 'ready';
}

// ---------------------------------------------------------------------------
// Name validation / duplicates
// ---------------------------------------------------------------------------

export interface PoolNameValidation {
	isValid: boolean;
	/** Trimmed name (present when valid). */
	normalized?: string;
	error?: string;
}

export function validatePoolName(raw: string): PoolNameValidation {
	const trimmed = raw.trim();
	if (!trimmed) return { isValid: false, error: 'กรุณาระบุชื่อกอง' };
	if (trimmed.length > BULK_RETURN_POOL_NAME_MAX_LENGTH) {
		return {
			isValid: false,
			error: `ชื่อกองต้องไม่เกิน ${BULK_RETURN_POOL_NAME_MAX_LENGTH} ตัวอักษร`
		};
	}
	return { isValid: true, normalized: trimmed };
}

/**
 * Advisory duplicate check among OPEN pools only (case-insensitive on the trimmed name).
 * Returns the clashing pool, or null. `excludePoolId` skips the pool being renamed.
 */
export function findDuplicateOpenPoolName(
	rows: readonly BulkReturnPoolRow[],
	name: string,
	excludePoolId?: string
): BulkReturnPoolV3 | null {
	if (!name.trim()) return null;
	return (
		rows
			.map((row) => row.pool)
			.find((pool) => isPoolNameTakenAmongOpen(name, [pool], excludePoolId)) ?? null
	);
}

// ---------------------------------------------------------------------------
// Pool / entry capabilities (state only; role checks live in the component via the auth helpers)
// ---------------------------------------------------------------------------

/** Name / location / notes can be edited, entries added or voided: pool OPEN and not locked. */
export function isPoolEditable(pool: Pick<BulkReturnPoolV3, 'status' | 'lock'>): boolean {
	return canAppendToPool(pool);
}

/** A pool may be cancelled only when OPEN, unlocked and holding no live entry. */
export function canCancelPool(row: BulkReturnPoolRow): boolean {
	return isPoolEditable(row.pool) && row.is_empty;
}

/** Why cancelling is unavailable, or null when it is allowed. */
export function getCancelPoolBlockedReason(row: BulkReturnPoolRow): string | null {
	if (canCancelPool(row)) return null;
	if (row.pool.status !== 'OPEN') return 'ยกเลิกได้เฉพาะกองที่ยังเปิดรับอยู่';
	if (row.pool.lock) return POOL_LOCKED_REASON;
	return NOT_EMPTY_CANCEL_REASON;
}

/** Targets for moving an entry: other OPEN, unlocked pools (never the source pool). */
export function listMoveTargets(
	rows: readonly BulkReturnPoolRow[],
	fromPoolId: string
): BulkReturnPoolV3[] {
	return rows
		.map((row) => row.pool)
		.filter((pool) => pool._id !== fromPoolId && isPoolEditable(pool))
		.sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

export interface LiveEntry {
	entry: BulkReturnEntry;
	/** Landed in a pool after it left OPEN (needs to be moved to an OPEN pool). */
	late: boolean;
}

/** Non-voided entries of a pool row, oldest first, flagged with `late`. */
export function liveEntries(row: BulkReturnPoolRow): LiveEntry[] {
	const lateIds = new Set(row.late_entries.map((r) => r.entry._id));
	return row.entries
		.filter((r) => !r.voided)
		.map((r) => ({ entry: r.entry, late: lateIds.has(r.entry._id) }));
}

/** Move is offered while the pool is OPEN+unlocked, and always for a late entry (fence-escape). */
export function canMoveEntry(row: BulkReturnPoolRow, entryId: string): boolean {
	if (isPoolEditable(row.pool)) return true;
	return row.late_entries.some((r) => r.entry._id === entryId);
}

/** Void is only possible while the pool is OPEN and unlocked. */
export function canVoidEntry(row: BulkReturnPoolRow): boolean {
	return isPoolEditable(row.pool);
}

/**
 * CR-193 §35: "reopen loans" on an entry of a closed pool (SUBMITTED / RECEIVED, entry in the
 * snapshot) that has applied loan refs, for a role allowed to do it.
 * - `showButton`: every applied ref is still revertable (independent of `reopened`).
 * - `blockedNotice`: why the button is NOT offered where it otherwise would be (some applied loan
 *   was closed or moved on, so the workflow pre-check would reject the whole entry). Null when the
 *   entry is not a reopen candidate, the button shows, or the entry was already reopened.
 */
export function reopenLoanAction(args: {
	pool: Pick<BulkReturnPoolV3, 'status' | 'entry_ids'>;
	entryId: string;
	appliedRefs: readonly Pick<AppliedBulkReturnLoanRef, 'revertable' | 'loan_status'>[];
	canReopen: boolean;
	reopened: boolean;
}): { showButton: boolean; blockedNotice: string | null } {
	const none = { showButton: false, blockedNotice: null };
	if (!args.canReopen || args.appliedRefs.length === 0) return none;
	if (!canReopenEntryLoans(args.pool, args.entryId)) return none;
	const blocked = args.appliedRefs.filter((ref) => !ref.revertable);
	if (blocked.length === 0) return { showButton: true, blockedNotice: null };
	if (args.reopened) return none;

	const total = args.appliedRefs.length;
	const lost = blocked.filter((ref) => ref.loan_status === 'lost').length;
	const waived = blocked.filter((ref) => ref.loan_status === 'waived').length;
	const copy = BULK_RETURN_REOPEN_BLOCKED_COPY;
	const closed = lost + waived;
	if (closed === 0) {
		const blockedNotice =
			blocked.length === total ? copy.allChanged : copy.someChanged(blocked.length, total);
		return { showButton: false, blockedNotice };
	}
	const label =
		lost > 0 && waived > 0 ? copy.labels.both : lost > 0 ? copy.labels.lost : copy.labels.waived;
	const blockedNotice =
		blocked.length === total ? copy.allClosed(label) : copy.someClosed(closed, total, label);
	return { showButton: false, blockedNotice };
}

/** Entry ids that have a `loan_reopened` timeline event. */
export function reopenedEntryIds(
	events: readonly { kind: string; entry_id?: string }[] | undefined
): Set<string> {
	const ids = new Set<string>();
	for (const event of events ?? []) {
		if (event.kind === 'loan_reopened' && event.entry_id) ids.add(event.entry_id);
	}
	return ids;
}

/** True when at least one live entry in the row offers an action (move or void). */
export function isEntryActionable(row: BulkReturnPoolRow): boolean {
	return isPoolEditable(row.pool) || row.late_entries.length > 0;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function poolStorageLabel(pool: Pick<BulkReturnPoolV3, 'location_storage_zone'>): string {
	const zone = pool.location_storage_zone?.trim();
	return zone ? zone : UNSPECIFIED_STORAGE_LABEL;
}

function shortId(id: string): string {
	const rest = id.replace(/^(evacuee|volunteer):/, '');
	if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(rest)) return `…${rest.slice(-6)}`;
	if (rest.length <= 12) return rest;
	// Cut at a ':' boundary when one falls inside the last 12 chars (…sh001:0000, not …t:sh001:0000).
	const tail = rest.slice(-12);
	const boundary = tail.indexOf(':');
	return `…${boundary > 0 ? tail.slice(boundary + 1) : tail}`;
}

export function returnerLabel(
	entry: Pick<BulkReturnEntry, 'returner_type' | 'returner_id'>
): string {
	if (entry.returner_type === 'unspecified' || !entry.returner_id) {
		return UNSPECIFIED_RETURNER_LABEL;
	}
	const kind = entry.returner_type === 'volunteer' ? 'อาสาสมัคร' : 'ผู้พักพิง';
	return `${kind} ${shortId(entry.returner_id)}`;
}

/**
 * Returner name for an entry: the resolved name from `namesById` (keyed by returner id), else the
 * `returnerLabel` fallback (short id; "ไม่ระบุผู้คืน" when unspecified).
 */
export function returnerDisplayName(
	entry: Pick<BulkReturnEntry, 'returner_type' | 'returner_id'>,
	namesById?: ReadonlyMap<string, string>
): string {
	if (entry.returner_type !== 'unspecified' && entry.returner_id) {
		const name = namesById?.get(entry.returner_id)?.trim();
		if (name) return name;
	}
	return returnerLabel(entry);
}

/** Summary line from the refs ACTUALLY applied on loans (not the entry's planned `loan_refs`). */
export function loanRefsSummary(appliedRefs: readonly { qty: string }[], unit?: string): string {
	if (appliedRefs.length === 0) return 'ไม่ได้ตัดยอดยืม';
	let total = '0';
	for (const ref of appliedRefs) total = addQty(total, ref.qty);
	return `ตัดยอดยืม ${appliedRefs.length} รายการ (รวม ${total}${unit ? ` ${unit}` : ''})`;
}

/** Groups applied-loan refs by entry id (ref order within each group is kept). */
export function groupAppliedLoanRefsByEntry(
	refs: readonly AppliedBulkReturnLoanRef[]
): Map<string, AppliedBulkReturnLoanRef[]> {
	const byEntry = new Map<string, AppliedBulkReturnLoanRef[]>();
	for (const ref of refs) {
		const list = byEntry.get(ref.entry_id) ?? [];
		list.push(ref);
		byEntry.set(ref.entry_id, list);
	}
	return byEntry;
}

/** Groups missed loan refs by entry id, keeping ref order. */
export function groupMissedLoanRefsByEntry(
	refs: readonly MissedBulkReturnLoanRef[]
): Map<string, MissedBulkReturnLoanRef[]> {
	const byEntry = new Map<string, MissedBulkReturnLoanRef[]>();
	for (const ref of refs) {
		const list = byEntry.get(ref.entry_id) ?? [];
		list.push(ref);
		byEntry.set(ref.entry_id, list);
	}
	return byEntry;
}

/** Entry ids of a row whose void / move had no effect (written after the submit snapshot). */
export function snapshotConflictEntryIds(
	row: Pick<BulkReturnPoolOverviewRow, 'snapshot_conflicts'> | null
): Set<string> {
	return new Set((row?.snapshot_conflicts ?? []).map((c) => c.entry_id));
}

/**
 * One warning line per ref that was not applied to its loan (loan drift). `closed` uses the main
 * text; `insufficient` adds that the qty was not deducted because the outstanding was lower.
 */
export function closedLoanRefNotice(
	ref: Pick<ClosedBulkReturnLoanRef, 'reason' | 'qty' | 'outstanding'>,
	unit?: string
): string {
	const u = unit ? ` ${unit}` : '';
	if (ref.reason === 'missing') return MISSING_LOAN_WARNING_TEXT;
	if (ref.reason === 'insufficient') {
		return `${CLOSED_LOAN_WARNING_TEXT} (จำนวน ${ref.qty}${u} ไม่ถูกหักจากยอดยืม เพราะยอดค้างคืนเหลือเพียง ${ref.outstanding ?? '0'}${u})`;
	}
	return CLOSED_LOAN_WARNING_TEXT;
}

/** Groups closed-loan refs by entry id (entry order within each group is kept). */
export function groupClosedLoanRefsByEntry(
	refs: readonly ClosedBulkReturnLoanRef[]
): Map<string, ClosedBulkReturnLoanRef[]> {
	const byEntry = new Map<string, ClosedBulkReturnLoanRef[]>();
	for (const ref of refs) {
		const list = byEntry.get(ref.entry_id) ?? [];
		list.push(ref);
		byEntry.set(ref.entry_id, list);
	}
	return byEntry;
}

export interface PoolCatalogItem {
	_id: string;
	name: string;
	base_unit?: string;
}

export interface ItemDisplay {
	name: string;
	unit: string;
}

export function resolveItemDisplay(
	itemId: string,
	catalog: readonly PoolCatalogItem[]
): ItemDisplay {
	const item = catalog.find((candidate) => candidate._id === itemId);
	if (item) return { name: item.name, unit: item.base_unit ?? '' };
	return { name: itemId.replace(/^item_master:|^item:/, ''), unit: '' };
}

// ---------------------------------------------------------------------------
// Header edit patch
// ---------------------------------------------------------------------------

export interface PoolHeaderFormValues {
	name: string;
	/** Storage point id; '' = unspecified. */
	storagePointId: string;
	notes: string;
}

/**
 * Builds a patch of CHANGED fields only. Notes cleared -> null; storage cleared -> null.
 * `resolvePoint` maps a point id to its `{id, name}` ref (undefined when unknown).
 */
export function buildHeaderPatch(
	pool: Pick<BulkReturnPoolV3, 'name' | 'location_storage_point_id' | 'notes'>,
	values: PoolHeaderFormValues,
	resolvePoint: (id: string) => { id: string; name: string } | undefined
): UpdateBulkReturnPoolHeaderPatch {
	const patch: UpdateBulkReturnPoolHeaderPatch = {};

	const name = values.name.trim();
	if (name !== pool.name) patch.name = name;

	const nextPointId = values.storagePointId.trim();
	if (nextPointId !== (pool.location_storage_point_id ?? '')) {
		if (nextPointId === '') {
			patch.storagePoint = null;
		} else {
			const point = resolvePoint(nextPointId);
			if (point) patch.storagePoint = { id: point.id, name: point.name };
		}
	}

	const notes = values.notes.trim();
	if (notes !== (pool.notes ?? '')) patch.notes = notes === '' ? null : notes;

	return patch;
}

export function isPatchEmpty(patch: UpdateBulkReturnPoolHeaderPatch): boolean {
	return Object.keys(patch).length === 0;
}

/** Label on the pool card clarifying that late entries are not part of the stored total. */
export const LATE_CARD_EXCLUDED_TEXT = 'ไม่รวมในยอดที่เก็บเข้าคลัง';

/** Per-item note on the pool card for the late quantity included in the live total. */
export function lateItemQtyText(qty: string, unit: string): string {
	return `รวมของค้าง ${qty} ${unit}`.trim();
}

type RosterPerson = {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string | null;
};

/** Returner id → display name from the shelter rosters (same wording as RecipientName). */
export function buildReturnerNames(
	evacuees: readonly RosterPerson[],
	volunteers: readonly RosterPerson[]
): ReadonlyMap<string, string> {
	const names = new Map<string, string>();
	for (const evacuee of evacuees) {
		const nickname = evacuee.nickname ? ` (${evacuee.nickname})` : '';
		names.set(evacuee._id, `${evacuee.first_name} ${evacuee.last_name}${nickname}`);
	}
	for (const volunteer of volunteers) {
		names.set(volunteer._id, `จิตอาสา ${volunteer.first_name} ${volunteer.last_name}`);
	}
	return names;
}
