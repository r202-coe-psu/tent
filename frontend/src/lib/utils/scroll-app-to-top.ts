/**
 * Reset viewport scroll and nested app-shell overflow containers.
 * Staff shells ((protected)/main, onsite, back-office, portal) scroll inside
 * overflow-y containers rather than the window — window.scrollTo alone is not enough.
 */
export function scrollAppToTop(): void {
	if (typeof window === 'undefined') return;

	window.scrollTo(0, 0);
	document.documentElement.scrollTop = 0;
	document.body.scrollTop = 0;

	const containers = document.querySelectorAll<HTMLElement>(
		'main, .overflow-y-auto, .overflow-y-scroll, .overflow-auto'
	);
	for (const el of containers) {
		if (el.scrollTop !== 0) el.scrollTop = 0;
	}
}
