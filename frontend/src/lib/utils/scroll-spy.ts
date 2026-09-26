/**
 * Shared scroll-spy helpers for long single-page forms (shelter form, registration, …).
 *
 * IntersectionObserver only delivers *changed* entries per callback — callers must
 * merge ratios into a map before picking. When the form is scrolled to the end,
 * prefer the last nav section so a short trailing block (e.g. members + bottom chrome)
 * does not leave the spy stuck on an earlier section.
 *
 * `createScrollSpy` wraps the whole behaviour into a Svelte 5 attachment so features
 * can do `{@attach spy}` without forking the observer plumbing.
 */

import type { Attachment } from 'svelte/attachments';

export interface IntersectionEntryLike {
	id: string;
	isIntersecting: boolean;
	intersectionRatio: number;
}

/**
 * Merge *changed* IntersectionObserver entries into a running ratio map.
 * Non-intersecting targets drop to ratio 0 instead of being deleted, so the
 * previously-active section can still be outranked by a later one.
 */
export function applyIntersectionEntries(
	ratiosById: Map<string, number>,
	entries: ReadonlyArray<IntersectionEntryLike>
): void {
	for (const entry of entries) {
		ratiosById.set(entry.id, entry.isIntersecting ? entry.intersectionRatio : 0);
	}
}

/**
 * Pick the active section: the last section when the form is scrolled to the end,
 * otherwise the highest-ratio section (null when nothing has a positive ratio).
 */
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

/** True when an overflow scroll root (or the document scroller) is within `thresholdPx` of the bottom. */
export function isScrollNearEnd(scrollRoot: Element | null, thresholdPx = 24): boolean {
	if (scrollRoot) {
		return scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - thresholdPx;
	}
	const el = document.scrollingElement ?? document.documentElement;
	return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx;
}

/** Parse a `px` / `rem` / unitless CSS length into pixels, or null when unusable. */
function parseCssLengthPx(raw: string, rootFontPx: number): number | null {
	const value = raw.trim();
	if (!value) return null;
	if (value.endsWith('px')) {
		const n = Number.parseFloat(value);
		return Number.isFinite(n) ? n : null;
	}
	if (value.endsWith('rem')) {
		const rem = Number.parseFloat(value);
		return Number.isFinite(rem) ? rem * rootFontPx : null;
	}
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a sticky-top CSS custom property (e.g. `--registration-sticky-top`) on an
 * element for IntersectionObserver rootMargin. Layouts set the CSS var; callers pass
 * the var name so the same helper serves every form.
 */
export function readStickyTopPx(el: Element, cssVarName: string, fallbackPx = 64): number {
	const style = getComputedStyle(el);
	const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	return parseCssLengthPx(style.getPropertyValue(cssVarName), rootFont) ?? fallbackPx;
}

export interface ScrollSpyOptions {
	/** Section ids without the `prefix` (static array or getter for reactive lists). */
	sectionIds: string[] | (() => string[]);
	/** Element id prefix: section `foo` is looked up as `#${prefix}foo`. */
	prefix: string;
	/** CSS custom property holding the sticky header height, e.g. `--shelter-form-sticky-top`. */
	stickyVar: string;
	/** Suppress spy updates for this long after `pause()` (smooth-scroll window). Default 700. */
	pauseMs?: number;
	/** Called whenever the active section changes to a non-null id. */
	onActiveChange: (id: string) => void;
}

export interface ScrollSpyAttachment extends Attachment<Element> {
	/** Suppress spy updates for `pauseMs` — call right before a programmatic smooth scroll. */
	pause(): void;
}

/** Walk up from `element` looking for the nearest overflow-y auto/scroll container. */
function findScrollParent(element: Element): Element | null {
	let parent = element.parentElement;
	while (parent) {
		const { overflowY } = getComputedStyle(parent);
		if (overflowY === 'auto' || overflowY === 'scroll') return parent;
		parent = parent.parentElement;
	}
	return null;
}

/**
 * Build a Svelte 5 attachment that keeps a nav section highlighted while the user
 * scrolls. Use as `{@attach spy}` on the form container.
 *
 * ```svelte
 * const spy = createScrollSpy({
 *   sectionIds: SECTION_IDS,
 *   prefix: 'shelter-section-',
 *   stickyVar: '--shelter-form-sticky-top',
 *   onActiveChange: (id) => (activeSection = id)
 * });
 * // click-to-scroll: spy.pause(); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
 * ```
 */
export function createScrollSpy(options: ScrollSpyOptions): ScrollSpyAttachment {
	const pauseMs = options.pauseMs ?? 700;
	let pauseUntil = 0;

	const resolveIds = (): string[] =>
		typeof options.sectionIds === 'function' ? options.sectionIds() : options.sectionIds;

	const attachment = ((node: Element) => {
		const scrollRoot = findScrollParent(node);
		const stickyTopPx = readStickyTopPx(node, options.stickyVar);
		const ratiosById = new Map<string, number>();

		const syncActive = () => {
			if (Date.now() < pauseUntil) return;
			const sectionIds = resolveIds();
			const next = pickActiveSectionId(sectionIds, ratiosById, {
				atScrollEnd: isScrollNearEnd(scrollRoot)
			});
			if (next) options.onActiveChange(next);
		};

		const observer = new IntersectionObserver(
			(entries) => {
				applyIntersectionEntries(
					ratiosById,
					entries.flatMap((entry) => {
						const target = entry.target;
						if (!(target instanceof HTMLElement) || !target.id.startsWith(options.prefix)) {
							return [];
						}
						return [
							{
								id: target.id.slice(options.prefix.length),
								isIntersecting: entry.isIntersecting,
								intersectionRatio: entry.intersectionRatio
							}
						];
					})
				);
				syncActive();
			},
			{
				root: scrollRoot,
				rootMargin: `-${Math.round(stickyTopPx + 8)}px 0px -55% 0px`,
				threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
			}
		);

		const observed = new Set<Element>();
		const observeAll = () => {
			for (const id of resolveIds()) {
				const el = document.getElementById(`${options.prefix}${id}`);
				if (el && !observed.has(el)) {
					observer.observe(el);
					observed.add(el);
				}
			}
		};
		observeAll();
		// Sections can mount in a later flush than the container — re-scan once.
		queueMicrotask(observeAll);

		const scrollTarget: Element | Window = scrollRoot ?? window;
		scrollTarget.addEventListener('scroll', syncActive, { passive: true });

		return () => {
			observer.disconnect();
			observed.clear();
			scrollTarget.removeEventListener('scroll', syncActive);
		};
	}) as ScrollSpyAttachment;

	attachment.pause = () => {
		pauseUntil = Date.now() + pauseMs;
	};

	return attachment;
}
