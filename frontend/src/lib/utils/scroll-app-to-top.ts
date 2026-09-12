/**
 * Reset document scroll on client navigations.
 * Staff shells use the browser window as the primary scroller.
 */
export function scrollAppToTop(): void {
	if (typeof window === 'undefined') return;

	window.scrollTo(0, 0);
	document.documentElement.scrollTop = 0;
	document.body.scrollTop = 0;
}
