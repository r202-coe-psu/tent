import { z } from 'zod';

export const KIOSK_BANNER_TEMPLATE_LIMITS = {
	headingMax: 120,
	bodyMax: 600
} as const;

/** Name of the banner's own attachment that a template's `image` points to. */
export const TEMPLATE_IMAGE_ATTACHMENT = 'template_image';

/**
 * The logo travels in the same JSON body as the rendered PNG (up to 2 MB), so it gets the footer
 * logo's smaller cap to keep the pair well under the 4 MB request body limit.
 */
export const TEMPLATE_IMAGE_MAX_BYTES = 512 * 1024;
export const TEMPLATE_IMAGE_TOO_LARGE_MESSAGE = 'รูป/โลโก้ต้องมีขนาดไม่เกิน 512 KB';

/** `#RRGGBB` only (any case in, lowercase out) so a colour can never smuggle CSS like `url(...)`. */
export const bannerColorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, 'สีต้องอยู่ในรูปแบบ #RRGGBB')
	.transform((v) => v.toLowerCase());

export const kioskBannerTemplateAlignSchema = z.enum(['left', 'center', 'right']);

/** Structured template data stored on the banner doc; the kiosk renders it, never raw HTML. */
export const kioskBannerTemplateSchema = z
	.strictObject({
		heading: z
			.string()
			.trim()
			.max(KIOSK_BANNER_TEMPLATE_LIMITS.headingMax, 'หัวข้อประกาศยาวเกิน 120 ตัวอักษร'),
		body: z
			.string()
			.trim()
			.max(KIOSK_BANNER_TEMPLATE_LIMITS.bodyMax, 'เนื้อหาประกาศยาวเกิน 600 ตัวอักษร'),
		align: kioskBannerTemplateAlignSchema,
		bg_color: bannerColorSchema,
		text_color: bannerColorSchema,
		/** A reference to the banner's own attachment, never a URL. */
		image: z.literal(TEMPLATE_IMAGE_ATTACHMENT).nullable()
	})
	.refine((v) => v.heading !== '' || v.body !== '', {
		message: 'ระบุหัวข้อหรือเนื้อหาประกาศ',
		path: ['heading']
	});

export type KioskBannerTemplate = z.infer<typeof kioskBannerTemplateSchema>;
export type KioskBannerTemplateAlign = z.infer<typeof kioskBannerTemplateAlignSchema>;

function relativeLuminance(hex: string): number {
	const channel = (offset: number): number => {
		const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2.x contrast ratio (1–21) of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True when the pair is below WCAG AA (4.5:1) for normal text — a warning, never a block. */
export function isHardToRead(bg: string, text: string): boolean {
	return contrastRatio(bg, text) < 4.5;
}

/** Swatches offered in the colour picker; staff may still enter any custom `#rrggbb`. */
export const BANNER_COLOR_PRESETS: readonly { value: string; label: string }[] = [
	{ value: '#ffffff', label: 'ขาว' },
	{ value: '#000000', label: 'ดำ' },
	{ value: '#1e3a8a', label: 'น้ำเงิน' },
	{ value: '#b91c1c', label: 'แดง' },
	{ value: '#facc15', label: 'เหลือง' },
	{ value: '#15803d', label: 'เขียว' }
];

/** Default for a new template: blank text, centred, white on navy, no image. */
export function emptyKioskBannerTemplate(): KioskBannerTemplate {
	return {
		heading: '',
		body: '',
		align: 'center',
		bg_color: '#1e3a8a',
		text_color: '#ffffff',
		image: null
	};
}
