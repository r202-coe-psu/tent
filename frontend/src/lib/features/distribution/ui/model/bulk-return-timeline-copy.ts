/** Badge on a pool-timeline event written after the entry's snapshot pool was submitted (CR-193 §33). */
export const TIMELINE_NO_EFFECT_LABEL = 'ไม่มีผล (หลังส่งเข้าคลัง)';

export const TIMELINE_NO_EFFECT_BADGE_CLASS = 'border border-amber-200 bg-amber-50 text-amber-900';

/**
 * Text before the count in the skipped-docs warning.
 * Split so the UI can render the count in a tabular-nums span.
 */
export const POOL_TIMELINE_SKIPPED_NOTICE_PREFIX = 'พบเอกสารประวัติของกองนี้ที่ข้อมูลไม่ถูกต้อง';

/** Text after the count in the skipped-docs warning. */
export const POOL_TIMELINE_SKIPPED_NOTICE_SUFFIX =
	'รายการ ระบบข้ามไว้ไม่แสดง ประวัติอาจไม่ครบ — ติดต่อผู้ดูแลระบบ';

/** Screen-reader reason appended to the header badge. */
export const POOL_TIMELINE_SKIPPED_BADGE_SR_HINT = 'เอกสารข้อมูลไม่ถูกต้อง';

/**
 * Warning shown when the pool timeline read left out malformed event docs (CR-193 §19).
 */
export function poolTimelineSkippedNotice(count: number): string {
	return `${POOL_TIMELINE_SKIPPED_NOTICE_PREFIX} ${count} ${POOL_TIMELINE_SKIPPED_NOTICE_SUFFIX}`;
}

/** Collapsed-header marker for skipped docs. */
export function poolTimelineSkippedBadge(count: number): string {
	return `ข้าม ${count} รายการ`;
}

/** Empty-timeline label, aware of skipped docs. */
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

/**
 * True when the shelter-level skipped list already shows every skipped id of the timeline, so the
 * timeline banner would be a duplicate. Compares by `_id`, ignores empty ids; false while the
 * shelter list is unknown (undefined) or when the timeline has no non-empty id to prove coverage.
 */
export function isTimelineSkippedCoveredByShelter(
	timelineSkipped: readonly { _id: string }[],
	shelterSkipped: readonly { _id: string }[] | undefined
): boolean {
	if (!shelterSkipped) return false;
	const timelineIds = timelineSkipped.map((doc) => doc._id).filter(Boolean);
	if (timelineIds.length === 0) return false;
	const shelterIds = new Set(shelterSkipped.map((doc) => doc._id).filter(Boolean));
	return timelineIds.every((id) => shelterIds.has(id));
}
