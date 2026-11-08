import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KIOSK_LABEL_TEXT } from '../domain/print-label';
import { VOLUNTEER_LABEL_TEXT } from '../domain/volunteer-label';

// Label rendering fails closed when a face is missing (kiosk-label-image.ts), and the faces must
// load without Google Fonts, so the root layout self-hosts every family × weight a label draws.
const LAYOUT = fileURLToPath(new URL('../../../../routes/+layout.svelte', import.meta.url));
const FAMILIES = ['ibm-plex-sans-thai-looped', 'ibm-plex-sans-thai'];
const weights = [
	...new Set(
		[...Object.values(KIOSK_LABEL_TEXT), ...Object.values(VOLUNTEER_LABEL_TEXT)].map(
			(style) => style.weight
		)
	)
].sort();

describe('label fonts', () => {
	const layout = readFileSync(LAYOUT, 'utf8');

	it.each(FAMILIES.flatMap((family) => weights.map((weight) => `${family}/${weight}.css`)))(
		'the root layout self-hosts @fontsource/%s',
		(path) => {
			expect(layout).toContain(`import '@fontsource/${path}';`);
		}
	);
});
