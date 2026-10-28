import {
	DISTRIBUTION_STAFF,
	hasCapabilityInShelter,
	isShelterManager,
	isSystemAdmin,
	isWarehouseStaff
} from '$lib/auth/roles';
import type { BulkReturnPoolOverviewRow } from '../../domain/food-supplies';
import { MY_POOL_POINT_UNSPECIFIED } from './my-pool-point-storage';

/** Work queues shown above the bulk return pool board (#660). */

export type WorkQueueKind = 'waiting_receive' | 'flagged' | 'my_point';
export type FlagReason = 'late' | 'pending_sync' | 'closed_loan' | 'snapshot_conflict';

export const WORK_QUEUE_COPY = {
	waitingTitle: 'รอคลังตรวจรับ',
	flaggedTitle: 'ต้องจัดการ',
	agePrefix: 'รอมาแล้ว',
	ageUnderHour: 'ไม่ถึง 1 ชม.',
	reasonLabels: {
		late: 'มีรายการค้าง',
		pending_sync: 'รอซิงก์',
		closed_loan: 'ยอดยืมถูกปิด',
		snapshot_conflict: 'ต้องตรวจสอบ'
	} satisfies Record<FlagReason, string>,
	waitingEmpty: 'ไม่มีกองที่รอตรวจรับ',
	flaggedEmpty: 'ไม่มีกองที่ต้องจัดการ',
	myPointTitle: 'กองที่จุดของฉัน',
	myPointEmpty: 'ไม่มีกองที่เปิดรับที่จุดนี้',
	myPointLabel: 'จุดของฉัน',
	myPointPlaceholder: 'เลือกจุดของฉัน',
	myPointUnspecified: 'ไม่ระบุจุดที่ตั้ง',
	myPointHint: 'เลือกจุดของคุณเพื่อดูกองที่เปิดรับที่จุดนั้น (จำไว้ในเครื่องนี้)'
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface WaitingPool {
	row: BulkReturnPoolOverviewRow;
	ageMs: number;
}

export interface FlaggedPool {
	row: BulkReturnPoolOverviewRow;
	reasons: { reason: FlagReason; count: number }[];
}

function timeOrNow(iso: string | undefined, now: number): number {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? now : t;
}

/** SUBMITTED pools, oldest submission first. */
export function waitingForReceive(
	rows: readonly BulkReturnPoolOverviewRow[],
	now: Date
): WaitingPool[] {
	const nowMs = now.getTime();
	return rows
		.filter((row) => row.pool.status === 'SUBMITTED')
		.map((row) => {
			const submittedMs = timeOrNow(row.pool.submitted_at, nowMs);
			return { row, submittedMs, ageMs: Math.max(0, nowMs - submittedMs) };
		})
		.sort((a, b) => a.submittedMs - b.submittedMs)
		.map(({ row, ageMs }) => ({ row, ageMs }));
}

/** Same predicate as the board's "needs attention" filter. */
export function rowNeedsAttention(row: BulkReturnPoolOverviewRow): boolean {
	return (
		row.late_entries.length > 0 ||
		row.unresolved_refs.length > 0 ||
		row.closed_loan_refs.length > 0 ||
		row.snapshot_conflicts.length > 0
	);
}

/** Non-cancelled pools needing attention; most reasons first, then oldest `created_at`. */
export function flaggedPools(rows: readonly BulkReturnPoolOverviewRow[]): FlaggedPool[] {
	return rows
		.filter((row) => row.pool.status !== 'CANCELLED' && rowNeedsAttention(row))
		.map((row) => {
			const reasons: FlaggedPool['reasons'] = [];
			if (row.late_entries.length > 0)
				reasons.push({ reason: 'late', count: row.late_entries.length });
			if (row.unresolved_refs.length > 0) {
				reasons.push({ reason: 'pending_sync', count: row.unresolved_refs.length });
			}
			if (row.closed_loan_refs.length > 0) {
				reasons.push({ reason: 'closed_loan', count: row.closed_loan_refs.length });
			}
			if (row.snapshot_conflicts.length > 0) {
				reasons.push({ reason: 'snapshot_conflict', count: row.snapshot_conflicts.length });
			}
			return { row, reasons };
		})
		.sort((a, b) => {
			if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
			const ac = a.row.pool.created_at;
			const bc = b.row.pool.created_at;
			if (ac !== bc) return ac < bc ? -1 : 1;
			return a.row.pool._id < b.row.pool._id ? -1 : a.row.pool._id > b.row.pool._id ? 1 : 0;
		});
}

/** < 1 h: "ไม่ถึง 1 ชม."; < 24 h: "n ชม."; else "n วัน" (floored). */
export function formatWaitingAge(ms: number): string {
	if (!Number.isFinite(ms) || ms < HOUR_MS) return WORK_QUEUE_COPY.ageUnderHour;
	if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} ชม.`;
	return `${Math.floor(ms / DAY_MS)} วัน`;
}

/**
 * OPEN pools stored at the given point, newest first. `'unspecified'` matches pools without a
 * storage point.
 */
export function openPoolsAtPoint(
	rows: readonly BulkReturnPoolOverviewRow[],
	pointId: string
): BulkReturnPoolOverviewRow[] {
	return rows
		.filter((row) => {
			if (row.pool.status !== 'OPEN') return false;
			const poolPoint = row.pool.location_storage_point_id;
			return pointId === MY_POOL_POINT_UNSPECIFIED ? !poolPoint : poolPoint === pointId;
		})
		.sort((a, b) => {
			const ac = a.pool.created_at;
			const bc = b.pool.created_at;
			if (ac !== bc) return ac > bc ? -1 : 1;
			return a.pool._id < b.pool._id ? -1 : a.pool._id > b.pool._id ? 1 : 0;
		});
}

/**
 * Which queues the viewer sees. System admin / shelter manager get all three (waiting_receive,
 * flagged, my_point). Everyone else gets the union of their roles: warehouse staff ->
 * waiting_receive, distribution staff -> the per-device "my point" queue.
 */
export function workQueuesFor(ctx: {
	roles?: readonly string[];
	shelterCode?: string | null;
}): WorkQueueKind[] {
	const roles = ctx.roles ?? [];
	if (isSystemAdmin(roles) || isShelterManager(roles, ctx.shelterCode)) {
		return ['waiting_receive', 'flagged', 'my_point'];
	}
	const queues: WorkQueueKind[] = [];
	if (isWarehouseStaff(roles, ctx.shelterCode)) queues.push('waiting_receive');
	if (hasCapabilityInShelter(roles, ctx.shelterCode, DISTRIBUTION_STAFF)) queues.push('my_point');
	return queues;
}
