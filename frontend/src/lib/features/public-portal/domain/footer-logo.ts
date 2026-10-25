import { z } from 'zod';

/** Footer partner logos on `config:public_portal` (CR-184 FR-1..5). */
export const FOOTER_LOGO_MAX = 12;
export const FOOTER_LOGO_ALT_MAX = 120;
/** Smaller than a kiosk banner's 2 MB: a logo renders 48 px tall and rides the singleton (CR-184 Q1). */
export const FOOTER_LOGO_IMAGE_MAX_BYTES = 512 * 1024;
export const FOOTER_LOGO_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const FOOTER_LOGO_TOO_LARGE_MESSAGE = 'รูปภาพต้องมีขนาดไม่เกิน 512 KB';

/**
 * Client-side UX pre-check (FR-11); the server re-checks size and magic bytes (FR-5).
 * Returns a Thai message, or `null` when the file looks acceptable.
 */
export function validateFooterLogoFile(file: { type: string; size: number }): string | null {
	if (!(FOOTER_LOGO_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		return 'รองรับเฉพาะรูป png / jpeg / webp';
	}
	if (file.size === 0) return 'ไม่พบข้อมูลรูปภาพ';
	if (file.size > FOOTER_LOGO_IMAGE_MAX_BYTES) return FOOTER_LOGO_TOO_LARGE_MESSAGE;
	return null;
}

const httpsUrl = z
	.string()
	.trim()
	.url('URL ไม่ถูกต้อง')
	.refine((value) => value.startsWith('https://'), 'ลิงก์ต้องขึ้นต้นด้วย https://');

/** Fields an SA edits; `id` and `order` are server-owned. */
export const footerLogoInputSchema = z.object({
	alt_th: z
		.string()
		.trim()
		.min(1, 'กรุณาระบุชื่อหน่วยงาน')
		.max(FOOTER_LOGO_ALT_MAX, `ไม่เกิน ${FOOTER_LOGO_ALT_MAX} ตัวอักษร`),
	alt_en: z
		.string()
		.trim()
		.max(FOOTER_LOGO_ALT_MAX, `ไม่เกิน ${FOOTER_LOGO_ALT_MAX} ตัวอักษร`)
		.default(''),
	link_url: httpsUrl.or(z.literal('')).default(''),
	is_published: z.boolean().default(true)
});

export const footerLogoSchema = footerLogoInputSchema.extend({
	id: z.string().min(1),
	order: z.number().int().min(1)
});

export type FooterLogoInput = z.infer<typeof footerLogoInputSchema>;
export type FooterLogo = z.infer<typeof footerLogoSchema>;

/** What the public footer receives — no `order`/`is_published`, image via BFF route. */
export interface PublicFooterLogo {
	id: string;
	alt_th: string;
	alt_en: string;
	link_url: string;
	image_url: string;
}

/** Admin list row: the stored logo plus a preview URL (`null` when the attachment is missing). */
export type FooterLogoRecord = FooterLogo & { image_url: string | null };

export type FooterLogoDirection = 'up' | 'down';

export const footerLogoAttachmentName = (id: string): string => `footer_logo_${id}`;

/** `?v=` carries the attachment digest so a new image busts the public cache (FR-13). */
export function footerLogoImageUrl(id: string, digest?: string): string {
	const path = `/api/public/v1/config/footer-logos/${encodeURIComponent(id)}/image`;
	return digest ? `${path}?v=${encodeURIComponent(digest)}` : path;
}

/** Keep only entries that parse; a hand-edited bad entry must not break the footer. */
export function parseFooterLogos(raw: unknown): FooterLogo[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((item) => {
		const parsed = footerLogoSchema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
}

export function sortFooterLogos(logos: readonly FooterLogo[]): FooterLogo[] {
	return [...logos].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function publishedFooterLogos(logos: readonly FooterLogo[]): FooterLogo[] {
	return sortFooterLogos(logos.filter((logo) => logo.is_published));
}

const renumber = (logos: readonly FooterLogo[]): FooterLogo[] =>
	logos.map((logo, index) => ({ ...logo, order: index + 1 }));

export const canAddFooterLogo = (logos: readonly FooterLogo[]): boolean =>
	logos.length < FOOTER_LOGO_MAX;

/** Append at the end (FR-2 `order` ต่อท้าย); caller checks {@link canAddFooterLogo} first. */
export function appendFooterLogo(
	logos: readonly FooterLogo[],
	id: string,
	input: FooterLogoInput
): FooterLogo[] {
	const sorted = renumber(sortFooterLogos(logos));
	return [...sorted, { ...input, id, order: sorted.length + 1 }];
}

/** `null` when `id` is not in the list. */
export function replaceFooterLogo(
	logos: readonly FooterLogo[],
	id: string,
	input: FooterLogoInput
): FooterLogo[] | null {
	if (!logos.some((logo) => logo.id === id)) return null;
	return logos.map((logo) => (logo.id === id ? { ...logo, ...input } : logo));
}

export function removeFooterLogo(logos: readonly FooterLogo[], id: string): FooterLogo[] | null {
	if (!logos.some((logo) => logo.id === id)) return null;
	return renumber(sortFooterLogos(logos.filter((logo) => logo.id !== id)));
}

/** Swap with the neighbour; moving past either end leaves the order unchanged. */
export function moveFooterLogo(
	logos: readonly FooterLogo[],
	id: string,
	direction: FooterLogoDirection
): FooterLogo[] | null {
	const sorted = sortFooterLogos(logos);
	const from = sorted.findIndex((logo) => logo.id === id);
	if (from === -1) return null;
	const to = direction === 'up' ? from - 1 : from + 1;
	if (to >= 0 && to < sorted.length) [sorted[from], sorted[to]] = [sorted[to], sorted[from]];
	return renumber(sorted);
}
