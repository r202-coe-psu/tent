/** How long after a dismiss a trailing `click` is still treated as part of the same tap. */
export const KIOSK_SWALLOW_CLICK_MS = 500;

/**
 * Swallows the one `click` that follows the `pointerdown` which dismissed the attract overlay, so
 * the card underneath is never activated. Gives up after KIOSK_SWALLOW_CLICK_MS (drag, held key).
 * Returns a cancel function.
 */
export function swallowNextClick(target: Window = window): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const cancel = () => {
		target.removeEventListener('click', onClick, true);
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	function onClick(event: Event) {
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}

	target.addEventListener('click', onClick, true);
	timer = setTimeout(cancel, KIOSK_SWALLOW_CLICK_MS);
	return cancel;
}
