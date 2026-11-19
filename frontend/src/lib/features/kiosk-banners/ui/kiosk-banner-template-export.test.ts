import { describe, expect, it, vi } from 'vitest';
import {
	TemplateExportError,
	buildTemplateFontCss,
	exportTemplatePng
} from './kiosk-banner-template-export';

const noFontCss = async () => '';
const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';
const node = { tagName: 'DIV', querySelectorAll: () => [] } as unknown as HTMLElement;

function nodeWithImages(...decodes: (() => Promise<void>)[]): HTMLElement {
	const images = decodes.map((decode) => ({ decode }));
	return { tagName: 'DIV', querySelectorAll: () => images } as unknown as HTMLElement;
}

function setup(toPngResult: string = PNG_URL) {
	const calls: string[] = [];
	const toPng = vi.fn(async (): Promise<string> => {
		calls.push('toPng');
		return toPngResult;
	});
	const fonts = {
		load: vi.fn(async (font: string): Promise<FontFace[]> => {
			calls.push(`load:${font}`);
			return [];
		}),
		// A thenable so 'ready' is recorded when it is awaited, not when the fake is built.
		ready: {
			then: (resolve: (value: unknown) => void): void => {
				calls.push('ready');
				resolve({});
			}
		} as unknown as Promise<FontFaceSet>
	};
	return { calls, toPng, fonts };
}

describe('exportTemplatePng', () => {
	it('waits for the template font before rendering', async () => {
		const { calls, toPng, fonts } = setup();

		await exportTemplatePng(node, 'tv', { toPng: toPng as never, fonts, fontEmbedCss: noFontCss });

		expect(calls).toEqual([
			'load:700 64px "IBM Plex Sans Thai Looped"',
			'load:400 32px "IBM Plex Sans Thai Looped"',
			'ready',
			'toPng'
		]);
	});

	it.each([
		['tv', 1920, 1080],
		['portrait', 1080, 1920]
	] as const)('renders at the real %s screen size', async (screen, width, height) => {
		const { toPng, fonts } = setup();

		await exportTemplatePng(node, screen, {
			toPng: toPng as never,
			fonts,
			fontEmbedCss: noFontCss
		});

		expect(toPng).toHaveBeenCalledWith(node, {
			width,
			height,
			canvasWidth: width,
			canvasHeight: height,
			pixelRatio: 1,
			style: { transform: 'none' }
		});
	});

	it('returns the png as a banner image payload', async () => {
		const { toPng, fonts } = setup();

		await expect(
			exportTemplatePng(node, 'compact', { toPng: toPng as never, fonts, fontEmbedCss: noFontCss })
		).resolves.toEqual({ content_type: 'image/png', data_base64: 'iVBORw0KGgo=' });
	});

	it('rejects when the render is not a png data url', async () => {
		const { toPng, fonts } = setup('data:image/svg+xml;base64,PHN2Zz4=');

		await expect(
			exportTemplatePng(node, 'compact', { toPng: toPng as never, fonts, fontEmbedCss: noFontCss })
		).rejects.toThrow('สร้างรูปประกาศไม่สำเร็จ');
	});

	it('waits for every image in the template to decode before rendering', async () => {
		const { calls, toPng, fonts } = setup();
		const withLogo = nodeWithImages(async () => {
			calls.push('decode');
		});

		await exportTemplatePng(withLogo, 'tv', {
			toPng: toPng as never,
			fonts,
			fontEmbedCss: noFontCss
		});

		expect(calls.indexOf('decode')).toBeGreaterThanOrEqual(0);
		expect(calls.indexOf('decode')).toBeLessThan(calls.indexOf('toPng'));
	});

	it('refuses to render without a logo that failed to load', async () => {
		const { toPng, fonts } = setup();
		const broken = nodeWithImages(() => Promise.reject(new Error('404')));

		await expect(
			exportTemplatePng(broken, 'tv', { toPng: toPng as never, fonts, fontEmbedCss: noFontCss })
		).rejects.toThrow(
			new TemplateExportError('โหลดรูป/โลโก้ไม่สำเร็จ ลองเลือกรูปใหม่หรือลบรูปออก')
		);
		expect(toPng).not.toHaveBeenCalled();
	});

	it('rejects a png over the 2 MB banner cap with a message staff can act on', async () => {
		const tooBig = 'A'.repeat(Math.ceil(((2 * 1024 * 1024 + 1) * 4) / 3 / 4) * 4);
		const { toPng, fonts } = setup(`data:image/png;base64,${tooBig}`);

		await expect(
			exportTemplatePng(node, 'tv', { toPng: toPng as never, fonts, fontEmbedCss: noFontCss })
		).rejects.toThrow(
			new TemplateExportError('รูปประกาศใหญ่เกิน 2 MB ลองใช้รูป/โลโก้ที่เรียบขึ้นหรือลบรูปออก')
		);
	});

	it('gives up with a message when the font never finishes loading', async () => {
		const { toPng, fonts } = setup();
		const stuck = { ...fonts, ready: new Promise<FontFaceSet>(() => {}) };

		await expect(
			exportTemplatePng(node, 'tv', {
				toPng: toPng as never,
				fonts: stuck,
				fontEmbedCss: noFontCss,
				timeoutMs: 5
			})
		).rejects.toThrow(new TemplateExportError('โหลดฟอนต์ไม่สำเร็จ ลองบันทึกอีกครั้ง'));
		expect(toPng).not.toHaveBeenCalled();
	});

	it('gives up with a message when the logo never finishes decoding', async () => {
		const { toPng, fonts } = setup();
		const hanging = nodeWithImages(() => new Promise<void>(() => {}));

		await expect(
			exportTemplatePng(hanging, 'tv', {
				toPng: toPng as never,
				fonts,
				fontEmbedCss: noFontCss,
				timeoutMs: 5
			})
		).rejects.toThrow(
			new TemplateExportError('โหลดรูป/โลโก้ไม่สำเร็จ ลองเลือกรูปใหม่หรือลบรูปออก')
		);
		expect(toPng).not.toHaveBeenCalled();
	});

	it('embeds only the given template font css when there is one', async () => {
		const { toPng, fonts } = setup();

		await exportTemplatePng(node, 'tv', {
			toPng: toPng as never,
			fonts,
			fontEmbedCss: async () => '@font-face{}'
		});

		expect(toPng).toHaveBeenCalledWith(
			node,
			expect.objectContaining({ fontEmbedCSS: '@font-face{}' })
		);
	});
});

type FakeRule = { type: number; style: { getPropertyValue: (name: string) => string } };

function fontFace(weight: string, src: string, family = '"IBM Plex Sans Thai Looped"'): FakeRule {
	const props: Record<string, string> = {
		'font-family': family,
		'font-weight': weight,
		src,
		'unicode-range': 'U+0E01-0E5B'
	};
	return { type: 5, style: { getPropertyValue: (name) => props[name] ?? '' } };
}

const woff2 = (file: string) =>
	`url("/fonts/${file}.woff2") format("woff2"), url("/fonts/${file}.woff") format("woff")`;

function docWith(...sheets: { href: string | null; cssRules?: FakeRule[] }[]): Document {
	return {
		baseURI: 'http://app.test/back-office/',
		styleSheets: sheets.map((sheet) =>
			sheet.cssRules
				? sheet
				: {
						href: sheet.href,
						get cssRules(): never {
							throw new DOMException('cross-origin', 'SecurityError');
						}
					}
		)
	} as unknown as Document;
}

describe('buildTemplateFontCss', () => {
	const fetchFont = vi.fn(async (url: string | URL | Request) => {
		void url;
		return new Response(new Uint8Array([1, 2, 3]));
	});

	it('inlines only the woff2 of the template font at weights 400 and 700', async () => {
		fetchFont.mockClear();
		const doc = docWith(
			{ href: 'https://fonts.googleapis.com/css2' },
			{
				href: null,
				cssRules: [
					fontFace('300', woff2('looped-300')),
					fontFace('400', woff2('looped-400')),
					fontFace('700', woff2('looped-700')),
					fontFace('400', woff2('plain-400'), '"IBM Plex Sans Thai"'),
					{ type: 1, style: { getPropertyValue: () => '' } }
				]
			}
		);

		const css = await buildTemplateFontCss(doc, fetchFont as typeof fetch);

		expect(fetchFont.mock.calls.map(([url]) => String(url))).toEqual([
			'http://app.test/fonts/looped-400.woff2',
			'http://app.test/fonts/looped-700.woff2'
		]);
		expect(css.match(/@font-face/g)).toHaveLength(2);
		expect(css).toContain('font-weight:400');
		expect(css).toContain('font-weight:700');
		expect(css).toContain('url(data:font/woff2;base64,AQID) format("woff2")');
		expect(css).toContain('unicode-range:U+0E01-0E5B');
		expect(css).not.toContain('/fonts/');
	});

	it('is empty when the template font is not in any readable sheet', async () => {
		expect(
			await buildTemplateFontCss(docWith({ href: 'https://x' }), fetchFont as typeof fetch)
		).toBe('');
	});
});
