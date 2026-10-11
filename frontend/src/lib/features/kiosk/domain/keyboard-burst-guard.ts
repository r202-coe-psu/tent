/**
 * Tells keys typed by a USB QR reader from a person's: every key that follows the previous one
 * within `maxGapMs` is part of a burst. The first key of a burst is not recognisable in advance —
 * for our `evacuee:…` codes it is "e", which no kiosk screen reacts to.
 */
export type BurstGuard = {
	/** True when this keydown belongs to a reader burst and must not reach the focused element. */
	isBurstKey(timestampMs: number): boolean;
};

export function createBurstGuard(maxGapMs: number): BurstGuard {
	let lastAt = Number.NEGATIVE_INFINITY;
	return {
		isBurstKey(timestampMs) {
			const burst = timestampMs - lastAt <= maxGapMs;
			lastAt = timestampMs;
			return burst;
		}
	};
}
