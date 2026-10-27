/** Badge on a pool-timeline event written after the entry's snapshot pool was submitted (CR-193 §33). */
export const TIMELINE_NO_EFFECT_LABEL = 'ไม่มีผล (หลังส่งเข้าคลัง)';

export const TIMELINE_NO_EFFECT_BADGE_CLASS = 'border border-amber-200 bg-amber-50 text-amber-900';

/**
 * Proposed copy (pending owner review): text before the count in the skipped-docs warning.
 * Split so the UI can render the count in a tabular-nums span.
 */
export const POOL_TIMELINE_SKIPPED_NOTICE_PREFIX = 'พบเอกสารประวัติของกองนี้ที่ข้อมูลไม่ถูกต้อง';

/** Proposed copy (pending owner review): text after the count in the skipped-docs warning. */
export const POOL_TIMELINE_SKIPPED_NOTICE_SUFFIX =
	'รายการ ระบบข้ามไว้ไม่แสดง ประวัติอาจไม่ครบ — ติดต่อผู้ดูแลระบบ';

/** Proposed copy (pending owner review): screen-reader reason appended to the header badge. */
export const POOL_TIMELINE_SKIPPED_BADGE_SR_HINT = 'เอกสารข้อมูลไม่ถูกต้อง';

/**
 * Proposed copy (pending owner review): warning shown when the pool timeline read left out
 * malformed event docs (CR-193 §19).
 */
export function poolTimelineSkippedNotice(count: number): string {
	return `${POOL_TIMELINE_SKIPPED_NOTICE_PREFIX} ${count} ${POOL_TIMELINE_SKIPPED_NOTICE_SUFFIX}`;
}

/** Proposed copy (pending owner review): collapsed-header marker for skipped docs. */
export function poolTimelineSkippedBadge(count: number): string {
	return `ข้าม ${count} รายการ`;
}

/** Proposed copy (pending owner review): empty-timeline label, aware of skipped docs. */
export function poolTimelineEmptyLabel(skippedCount: number): string {
	return skippedCount > 0 ? 'ไม่มีประวัติที่แสดงได้' : 'ยังไม่มีประวัติ';
}

/** Comma-joined ids of the skipped docs, empty ids dropped (CR-193 §19). */
export function formatSkippedDocIds(skipped: readonly { _id: string }[]): string {
	return skipped
		.map((doc) => doc._id)
		.filter(Boolean)
		.join(', ');
}
