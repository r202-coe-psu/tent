import { toPng as htmlToPng } from 'html-to-image';
import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import { KIOSK_BANNER_IMAGE_MAX_BYTES } from '../domain/kiosk-banner-image';
import type { BannerImagePayload } from '../data/kiosk-banner-file';

const TEMPLATE_FONT = '"IBM Plex Sans Thai Looped"';
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** A failure whose Thai message tells staff what to change; anything else is a generic error. */
export class TemplateExportError extends Error {}

export interface TemplateExportDeps {
	toPng?: typeof htmlToPng;
	fonts?: Pick<FontFaceSet, 'load' | 'ready'>;
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
	const { toPng = htmlToPng, fonts = document.fonts } = deps;
	const { width, height } = KIOSK_SCREENS[screen];

	await fonts.load(`700 64px ${TEMPLATE_FONT}`);
	await fonts.load(`400 32px ${TEMPLATE_FONT}`);
	await fonts.ready;
	try {
		await Promise.all(Array.from(node.querySelectorAll('img'), (img) => img.decode()));
	} catch {
		throw new TemplateExportError('โหลดรูป/โลโก้ไม่สำเร็จ ลองเลือกรูปใหม่หรือลบรูปออก');
	}

	const dataUrl = await toPng(node, {
		width,
		height,
		canvasWidth: width,
		canvasHeight: height,
		pixelRatio: 1,
		style: { transform: 'none' }
	});
	if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) throw new Error('สร้างรูปประกาศไม่สำเร็จ');

	const data_base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
	if (base64Bytes(data_base64) > KIOSK_BANNER_IMAGE_MAX_BYTES) {
		throw new TemplateExportError('รูปประกาศใหญ่เกิน 2 MB ลองใช้รูป/โลโก้ที่เรียบขึ้นหรือลบรูปออก');
	}
	return { content_type: 'image/png', data_base64 };
}
