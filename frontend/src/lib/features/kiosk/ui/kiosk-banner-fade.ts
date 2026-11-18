/**
 * Crossfade between banner slides, shared by the kiosk attract screen and the internal TV screen
 * so every banner display changes slides the same way. Outgoing and incoming slides overlap, so
 * each slide must be absolutely positioned in the same box.
 */
export const BANNER_SLIDE_FADE = { duration: 600 } as const;

/**
 * While the old slide fades out both images are in the DOM; hide the old one from screen readers
 * so its `alt` is not read next to the new one.
 */
export function hideOutgoing(event: Event): void {
	(event.currentTarget as Element).setAttribute('aria-hidden', 'true');
}
