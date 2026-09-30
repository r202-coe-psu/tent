/**
 * Kiosk layout profiles. CSS cannot import these, so the same strings are repeated as literals in
 * `app.css` (`@custom-variant kiosk-portrait`) and in kiosk `.svelte` `<style>` blocks;
 * `kiosk-layout.test.ts` fails when a literal drifts from these constants.
 */

/**
 * 24" monitor rotated to portrait (1080×1920). `orientation: portrait` never matches a landscape
 * panel at any size or device scale factor, so the original 1024×600 kiosk is untouched by design.
 * `min-height` keeps small portrait screens (e.g. 600×1024) on the original layout.
 */
export const KIOSK_PORTRAIT_MEDIA = 'screen and (orientation: portrait) and (min-height: 1200px)';

/** The original 10.1" 1024×600 panel: short viewport → compact header and tighter spacing. */
export const KIOSK_COMPACT_MEDIA = '(max-height: 650px)';
