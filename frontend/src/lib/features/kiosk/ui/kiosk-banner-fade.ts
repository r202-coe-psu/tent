/**
 * Crossfade between banner slides, shared by the kiosk attract screen and the internal TV screen
 * so every banner display changes slides the same way. Outgoing and incoming slides overlap, so
 * each slide must be absolutely positioned in the same box.
 */
export const BANNER_SLIDE_FADE = { duration: 600 } as const;
