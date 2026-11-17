import { toPng as htmlToPng } from 'html-to-image';
import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import { KIOSK_BANNER_IMAGE_MAX_BYTES } from '../domain/kiosk-banner-image';
import type { BannerImagePayload } from '../data/kiosk-banner-file';

const TEMPLATE_FONT_FAMILY = 'IBM Plex Sans Thai Looped';
const TEMPLATE_FONT = `"${TEMPLATE_FONT_FAMILY}"`;
const TEMPLATE_FONT_WEIGHTS = new Set(['400', '700']);
const FONT_FACE_RULE = 5;
const WOFF2_URL = /url\(\s*["']?([^"')]+)["']?\s*\)\s*format\(\s*["']woff2["']\s*\)/;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** A failure whose Thai message tells staff what to change; anything else is a generic error. */
export class TemplateExportError extends Error {}

export interface TemplateExportDeps {
	toPng?: typeof htmlToPng;
	fonts?: Pick<FontFaceSet, 'load' | 'ready'>;
	/** `@font-face` css to embed; empty lets html-to-image collect the fonts itself. */
	fontEmbedCss?: () => Promise<string>;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

/**
 * `@font-face` rules for the template font at the two weights the template uses, with the woff2
 * inlined. Left alone, html-to-image embeds every weight of every font family in the node and
 * reads cross-origin sheets (Google Fonts), which fails with a console error.
 */
export async function buildTemplateFontCss(
	doc: Document = document,
	fetchFont: typeof fetch = fetch
): Promise<string> {
	const faces: Promise<string>[] = [];
	for (const sheet of Array.from(doc.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // a cross-origin sheet; the template font is bundled with the app
		}
		const base = sheet.href ?? doc.baseURI;
		for (const rule of Array.from(rules)) {
			if (rule.type !== FONT_FACE_RULE) continue;
			const style = (rule as CSSFontFaceRule).style;
			const family = style.getPropertyValue('font-family').replace(/["']/g, '').trim();
			const weight = style.getPropertyValue('font-weight').trim();
			const woff2 = WOFF2_URL.exec(style.getPropertyValue('src'));
			if (family !== TEMPLATE_FONT_FAMILY || !TEMPLATE_FONT_WEIGHTS.has(weight) || !woff2) continue;
			const range = style.getPropertyValue('unicode-range').trim();
			faces.push(
				fetchFont(new URL(woff2[1], base).href)
					.then((res) => res.arrayBuffer())
					.then(
						(buf) =>
							`@font-face{font-family:${TEMPLATE_FONT};font-style:normal;font-weight:${weight};` +
							`src:url(data:font/woff2;base64,${toBase64(new Uint8Array(buf))}) format("woff2");` +
							(range ? `unicode-range:${range};` : '') +
							'}'
					)
			);
		}
	}
	return (await Promise.all(faces)).join('\n');
}

let cachedFontCss: Promise<string> | null = null;

/** Built once per page; a failed build is retried on the next export. */
function templateFontCss(): Promise<string> {
	cachedFontCss ??= buildTemplateFontCss().catch(() => {
		cachedFontCss = null;
		return '';
	});
	return cachedFontCss;
}

const base64Bytes = (base64: string): number => Math.floor((base64.length * 3) / 4);

/**
 * Render the template preview node to a PNG at the real screen size (ignoring any on-screen
 * scale) and shape it as the banner upload payload. The locked template font and the logo are
 * loaded first, so Thai text is not rasterised in a fallback font and the logo is not left out.
 */
export async function exportTemplatePng(
	node: HTMLElement,
	screen: KioskScreenType,
	deps: TemplateExportDeps = {}
): Promise<BannerImagePayload> {
	const { toPng = htmlToPng, fonts = document.fonts, fontEmbedCss = templateFontCss } = deps;
	const { width, height } = KIOSK_SCREENS[screen];

	await fonts.load(`700 64px ${TEMPLATE_FONT}`);
	await fonts.load(`400 32px ${TEMPLATE_FONT}`);
	await fonts.ready;
	try {
		await Promise.all(Array.from(node.querySelectorAll('img'), (img) => img.decode()));
	} catch {
		throw new TemplateExportError('โหลดรูป/โลโก้ไม่สำเร็จ ลองเลือกรูปใหม่หรือลบรูปออก');
	}

	const fontEmbedCSS = await fontEmbedCss();
	const dataUrl = await toPng(node, {
		width,
		height,
		canvasWidth: width,
		canvasHeight: height,
		pixelRatio: 1,
		style: { transform: 'none' },
		...(fontEmbedCSS ? { fontEmbedCSS } : {})
	});
	if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) throw new Error('สร้างรูปประกาศไม่สำเร็จ');

	const data_base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
	if (base64Bytes(data_base64) > KIOSK_BANNER_IMAGE_MAX_BYTES) {
		throw new TemplateExportError('รูปประกาศใหญ่เกิน 2 MB ลองใช้รูป/โลโก้ที่เรียบขึ้นหรือลบรูปออก');
	}
	return { content_type: 'image/png', data_base64 };
}
