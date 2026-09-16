/**
 * Scroll-spy helpers for long registration forms.
 *
 * IntersectionObserver only delivers *changed* entries per callback — callers must
 * merge ratios into a map before picking. When the form is scrolled to the end,
 * prefer the last nav section so a short trailing block (e.g. members + bottom chrome)
 * does not leave the spy stuck on pets / vehicles.
 */

export function applyIntersectionEntries(
	ratiosById: Map<string, number>,
	entries: ReadonlyArray<{
		id: string;
		isIntersecting: boolean;
		intersectionRatio: number;
	}>
): void {
	for (const entry of entries) {
		ratiosById.set(entry.id, entry.isIntersecting ? entry.intersectionRatio : 0);
	}
}

export function pickActiveSectionId(
	sectionIds: readonly string[],
	ratiosById: ReadonlyMap<string, number>,
	options?: { atScrollEnd?: boolean }
): string | null {
	if (sectionIds.length === 0) return null;
	if (options?.atScrollEnd) return sectionIds[sectionIds.length - 1] ?? null;

	let bestId: string | null = null;
	let bestRatio = 0;
	for (const id of sectionIds) {
		const ratio = ratiosById.get(id) ?? 0;
		if (ratio > bestRatio) {
			bestRatio = ratio;
			bestId = id;
		}
	}
	return bestId;
}

export function isScrollNearEnd(scrollRoot: Element | null, thresholdPx = 24): boolean {
	if (scrollRoot) {
		return (
			scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - thresholdPx
		);
	}
	const el = document.scrollingElement ?? document.documentElement;
	return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx;
}
