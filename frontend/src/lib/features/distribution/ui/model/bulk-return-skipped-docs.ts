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
