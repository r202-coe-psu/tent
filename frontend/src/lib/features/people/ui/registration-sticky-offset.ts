/**
 * Resolve `--registration-sticky-top` on an element for IntersectionObserver rootMargin.
 * Layouts set the CSS var; the form never forks sticky classes by channel.
 */

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

export function readRegistrationStickyTopPx(el: Element): number {
	const style = getComputedStyle(el);
	const rootFont =
		Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	return (
		parseCssLengthPx(style.getPropertyValue('--registration-sticky-top'), rootFont) ?? 64
	);
}
