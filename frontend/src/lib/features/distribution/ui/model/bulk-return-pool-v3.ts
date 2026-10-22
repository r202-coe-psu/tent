import { addQty } from '$lib/utils/qty';
import {
	canAppendToPool,
	isPoolNameTakenAmongOpen,
	type BulkReturnEntry,
	type BulkReturnPoolOverviewRow,
	type BulkReturnPoolV3,
	type BulkReturnPoolV3Status
} from '../../domain/food-supplies';
import type { UpdateBulkReturnPoolHeaderPatch } from '../../application/food-supplies/bulk-return-pool-v3-workflow';

/**
 * #659 — pure view-model helpers for the bulk return pool v3 board (list / detail / dialogs).
 * No Svelte, no I/O.
 */

export const BULK_RETURN_POOL_NAME_MAX_LENGTH = 80;

export const UNSPECIFIED_STORAGE_LABEL = 'ไม่ระบุ';
export const UNSPECIFIED_RETURNER_LABEL = 'ไม่ระบุผู้คืน';
export const NOT_EMPTY_CANCEL_REASON = 'ย้ายของออกให้หมดก่อน';
export const LATE_ENTRY_GUIDANCE = 'ย้ายไปกองอื่นที่ยังเปิดอยู่';

export type BulkReturnPoolRow = BulkReturnPoolOverviewRow;
export type BulkReturnPoolEntryRow = BulkReturnPoolOverviewRow['entries'][number];

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const BULK_RETURN_POOL_V3_STATUS_LABELS: Record<BulkReturnPoolV3Status, string> = {
	OPEN: 'เปิดรับ',
	SUBMITTED: 'ส่งแล้ว',
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

export interface PoolRowFilter {
	search?: string;
	showCancelled?: boolean;
}

/**
 * Name search (case-insensitive, trimmed); CANCELLED hidden unless `showCancelled`. Sorted OPEN,
 * SUBMITTED, RECEIVED, CANCELLED; newest `created_at` first within a status (id as tie-break).
 */
export function filterPoolRows(
	rows: readonly BulkReturnPoolRow[],
	filter: PoolRowFilter = {}
): BulkReturnPoolRow[] {
	const needle = (filter.search ?? '').trim().toLocaleLowerCase();
	return rows
		.filter((row) => {
			if (row.pool.status === 'CANCELLED' && !filter.showCancelled) return false;
			if (!needle) return true;
			return row.pool.name.toLocaleLowerCase().includes(needle);
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
	if (row.pool.lock) return 'กองนี้กำลังถูกดำเนินการ กรุณารอสักครู่แล้วรีเฟรช';
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
	const tail = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
	return tail.length > 8 ? `…${tail.slice(-6)}` : tail;
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

export function loanRefsSummary(entry: Pick<BulkReturnEntry, 'loan_refs'>, unit?: string): string {
	const refs = entry.loan_refs;
	if (refs.length === 0) return 'ไม่ได้ตัดยอดยืม';
	let total = '0';
	for (const ref of refs) total = addQty(total, ref.qty);
	return `ตัดยอดยืม ${refs.length} รายการ (รวม ${total}${unit ? ` ${unit}` : ''})`;
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
