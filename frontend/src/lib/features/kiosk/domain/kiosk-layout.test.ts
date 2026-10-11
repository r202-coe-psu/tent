import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KIOSK_COMPACT_MEDIA, KIOSK_PORTRAIT_MEDIA } from './kiosk-layout';

// CSS can't import the constants, so every copy of the query lives in a file that is scanned here.
const components = import.meta.glob(['../ui/*.svelte', '../../../../routes/kiosk/**/*.svelte'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

// Vitest swaps `.css?raw` for an empty string, so the stylesheet is read from disk instead.
const sources: Record<string, string> = {
	...components,
	'../../../../app.css': readFileSync(new URL('../../../../app.css', import.meta.url), 'utf8')
};

function mediaQueries(source: string): string[] {
	return [...source.matchAll(/@media\s+([^{]+?)\s*\{/g)].map((match) => match[1].trim());
}

function matchMediaLiterals(source: string): string[] {
	return [...source.matchAll(/matchMedia\(\s*(['"`])(.+?)\1\s*\)/g)].map((match) => match[2]);
}

describe('kiosk layout media queries', () => {
	it('scans the stylesheet and kiosk components', () => {
		const paths = Object.keys(sources);
		expect(paths.some((path) => path.endsWith('app.css'))).toBe(true);
		expect(paths.some((path) => path.endsWith('kiosk-shell.svelte'))).toBe(true);
		expect(paths.some((path) => path.includes('routes/kiosk/'))).toBe(true);
	});

	it('declares the kiosk-portrait variant with the shared portrait query', () => {
		const css = Object.entries(sources).find(([path]) => path.endsWith('app.css'))?.[1] ?? '';
		expect(css).toMatch(/@custom-variant\s+kiosk-portrait\s*\{/);
		expect(mediaQueries(css)).toContain(KIOSK_PORTRAIT_MEDIA);
	});

	it('uses the exact portrait query wherever a query mentions orientation', () => {
		for (const [path, source] of Object.entries(sources)) {
			for (const query of [...mediaQueries(source), ...matchMediaLiterals(source)]) {
				if (query.includes('orientation')) {
					expect(query, path).toBe(KIOSK_PORTRAIT_MEDIA);
				}
			}
		}
	});

	it('uses the exact compact query wherever a query mentions max-height: 650px', () => {
		for (const [path, source] of Object.entries(sources)) {
			for (const query of [...mediaQueries(source), ...matchMediaLiterals(source)]) {
				if (query.includes('max-height: 650px')) {
					expect(query, path).toBe(KIOSK_COMPACT_MEDIA);
				}
			}
		}
	});

	it('keeps the portrait profile out of landscape screens', () => {
		expect(KIOSK_PORTRAIT_MEDIA).toContain('orientation: portrait');
		expect(KIOSK_PORTRAIT_MEDIA).toContain('min-height: 1200px');
		expect(KIOSK_PORTRAIT_MEDIA.startsWith('screen and')).toBe(true);
	});
});
