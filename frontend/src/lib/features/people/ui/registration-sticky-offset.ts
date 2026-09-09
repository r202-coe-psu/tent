/**
 * Resolve `--registration-sticky-top` on an element for IntersectionObserver rootMargin.
 * Layouts set the CSS var; the form never forks sticky classes by channel.
 */
export function readRegistrationStickyTopPx(el: Element): number {
	const raw = getComputedStyle(el).getPropertyValue('--registration-sticky-top').trim();
	if (!raw) return 64;
	if (raw.endsWith('px')) {
		const n = Number.parseFloat(raw);
		return Number.isFinite(n) ? n : 64;
	}
	if (raw.endsWith('rem')) {
		const rem = Number.parseFloat(raw);
		const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		return Number.isFinite(rem) ? rem * rootFont : 64;
	}
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) ? n : 64;
}
