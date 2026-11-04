import { adminAttachment, adminRaw, ServiceError } from '$lib/server/couch-admin';
import { ulid } from '$lib/db/ulid';
import {
	DEFAULT_PUBLIC_PORTAL_CONFIG,
	appendFooterLogo,
	canAddFooterLogo,
	footerLogoAttachmentName,
	footerLogoImageUrl,
	moveFooterLogo,
	parseFooterLogos,
	publishedFooterLogos,
	removeFooterLogo,
	replaceFooterLogo,
	sortFooterLogos,
	FOOTER_LOGO_IMAGE_MAX_BYTES,
	FOOTER_LOGO_MAX,
	FOOTER_LOGO_TOO_LARGE_MESSAGE,
	type FooterLogo,
	type FooterLogoDirection,
	type FooterLogoInput,
	type FooterLogoRecord,
	type PublicFooterLogo
} from '$lib/features/public-portal';
import { decodeBannerImage, type KioskBannerImageMime } from '$lib/features/kiosk-banners';

/**
 * Footer partner logos on the `config:public_portal` singleton (CR-184).
 *
 * Metadata lives in `footer_logos[]`, bytes in `_attachments.footer_logo_{id}`. Every write is a
 * single PUT of the whole doc carrying the other attachments as stubs, so FAQ/social fields and
 * the other logos survive (FR-8, FR-10).
 */

export const PUBLIC_PORTAL_CONFIG_ID = 'config:public_portal';
const CONFIG_PATH = `/registry/${PUBLIC_PORTAL_CONFIG_ID}`;

type AttachmentStub = { stub: true; content_type: string; length?: number; digest?: string };
type InlineAttachment = { content_type: string; data: string };
type Attachments = Record<string, AttachmentStub | InlineAttachment>;

export type PublicPortalConfigRaw = Record<string, unknown> & {
	_rev?: string;
	footer_logos?: unknown;
	_attachments?: Record<string, AttachmentStub>;
};

export interface FooterLogoImage {
	bytes: Uint8Array;
	contentType: KioskBannerImageMime;
}

export async function readPublicPortalConfig(): Promise<PublicPortalConfigRaw | null> {
	const res = await adminRaw(CONFIG_PATH, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read ${PUBLIC_PORTAL_CONFIG_ID} (${res.status})`);
	}
	return res.data as PublicPortalConfigRaw;
}

/** `_attachments` and `footer_logos` of the stored doc — the FAQ/social save copies these (FR-10). */
export function preservedLogoFields(
	doc: PublicPortalConfigRaw | null
): Pick<PublicPortalConfigRaw, 'footer_logos' | '_attachments'> {
	if (!doc) return {};
	return {
		...(doc.footer_logos !== undefined ? { footer_logos: doc.footer_logos } : {}),
		...(doc._attachments ? { _attachments: doc._attachments } : {})
	};
}

export function footerLogoRecords(doc: PublicPortalConfigRaw | null): FooterLogoRecord[] {
	if (!doc) return [];
	return sortFooterLogos(parseFooterLogos(doc.footer_logos)).map((logo) => {
		const stub = doc._attachments?.[footerLogoAttachmentName(logo.id)];
		return { ...logo, image_url: stub ? footerLogoImageUrl(logo.id, stub.digest) : null };
	});
}

/** Published logos with an image, in footer order (FR-12). */
export function publicFooterLogos(doc: PublicPortalConfigRaw | null): PublicFooterLogo[] {
	if (!doc) return [];
	return publishedFooterLogos(parseFooterLogos(doc.footer_logos)).flatMap((logo) => {
		const stub = doc._attachments?.[footerLogoAttachmentName(logo.id)];
		if (!stub) return [];
		return [
			{
				id: logo.id,
				alt_th: logo.alt_th,
				alt_en: logo.alt_en,
				link_url: logo.link_url,
				image_url: footerLogoImageUrl(logo.id, stub.digest)
			}
		];
	});
}

const DECODE_MESSAGES = {
	empty: 'กรุณาเลือกรูปโลโก้',
	invalid_base64: 'ข้อมูลรูปภาพไม่ถูกต้อง',
	too_large: FOOTER_LOGO_TOO_LARGE_MESSAGE,
	unsupported_type: 'รองรับเฉพาะรูป png / jpeg / webp'
} as const;

/**
 * Reuses the CR-162 banner decoder with the logo's 512 KB cap (CR-184 FR-5): size + magic bytes,
 * never the client's MIME type. The size pre-check skips encoding an oversized upload.
 */
export async function decodeFooterLogoFile(file: unknown): Promise<FooterLogoImage> {
	if (!(file instanceof File) || file.size === 0) {
		throw new ServiceError('VALIDATION', DECODE_MESSAGES.empty);
	}
	if (file.size > FOOTER_LOGO_IMAGE_MAX_BYTES) {
		throw new ServiceError('VALIDATION', DECODE_MESSAGES.too_large);
	}
	const decoded = decodeBannerImage(
		{
			content_type: file.type,
			data_base64: Buffer.from(await file.arrayBuffer()).toString('base64')
		},
		FOOTER_LOGO_IMAGE_MAX_BYTES
	);
	if (!decoded.ok) throw new ServiceError('VALIDATION', DECODE_MESSAGES[decoded.reason]);
	return { bytes: decoded.bytes, contentType: decoded.contentType };
}

const toInline = (image: FooterLogoImage): InlineAttachment => ({
	content_type: image.contentType,
	data: Buffer.from(image.bytes).toString('base64')
});

const notFound = () => new ServiceError('VALIDATION', 'ไม่พบโลโก้นี้ โปรดโหลดหน้าใหม่');

interface Mutation {
	logos: FooterLogo[];
	attachments: Attachments;
}

/**
 * Read → apply → PUT with the caller's `_rev`. A stale `_rev` is CouchDB's 409 → `CONFLICT`.
 * A missing doc is created from the FAQ defaults the admin page already shows.
 */
async function mutateConfig(
	actor: string,
	rev: string,
	apply: (current: Mutation) => Mutation
): Promise<void> {
	const existing = await readPublicPortalConfig();
	const ts = new Date().toISOString();
	const base: Record<string, unknown> = existing ?? {
		_id: PUBLIC_PORTAL_CONFIG_ID,
		type: 'config',
		schema_v: 1,
		created_at: ts,
		created_by: actor,
		...structuredClone(DEFAULT_PUBLIC_PORTAL_CONFIG)
	};
	const next = apply({
		logos: parseFooterLogos(existing?.footer_logos),
		attachments: { ...(existing?._attachments ?? {}) }
	});

	const doc: Record<string, unknown> = {
		...base,
		updated_at: ts,
		footer_logos: next.logos,
		_attachments: next.attachments
	};
	if (rev) doc._rev = rev;
	else delete doc._rev;

	const res = await adminRaw(CONFIG_PATH, 'PUT', doc);
	if (res.status === 409) {
		throw new ServiceError('CONFLICT', 'มีผู้อื่นแก้ไขการตั้งค่านี้ โปรดโหลดใหม่');
	}
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not save ${PUBLIC_PORTAL_CONFIG_ID} (${res.status})`);
	}
}

export async function createFooterLogo(
	actor: string,
	rev: string,
	input: FooterLogoInput,
	image: FooterLogoImage
): Promise<void> {
	await mutateConfig(actor, rev, ({ logos, attachments }) => {
		if (!canAddFooterLogo(logos)) {
			throw new ServiceError('VALIDATION', `เพิ่มโลโก้ได้สูงสุด ${FOOTER_LOGO_MAX} รายการ`);
		}
		const id = ulid();
		return {
			logos: appendFooterLogo(logos, id, input),
			attachments: { ...attachments, [footerLogoAttachmentName(id)]: toInline(image) }
		};
	});
}

/** `image = null` keeps the current attachment stub (FR-9). */
export async function updateFooterLogo(
	actor: string,
	rev: string,
	id: string,
	input: FooterLogoInput,
	image: FooterLogoImage | null
): Promise<void> {
	await mutateConfig(actor, rev, ({ logos, attachments }) => {
		const next = replaceFooterLogo(logos, id, input);
		if (!next) throw notFound();
		return {
			logos: next,
			attachments: image
				? { ...attachments, [footerLogoAttachmentName(id)]: toInline(image) }
				: attachments
		};
	});
}

export async function setFooterLogoPublished(
	actor: string,
	rev: string,
	id: string,
	isPublished: boolean
): Promise<void> {
	await mutateConfig(actor, rev, ({ logos, attachments }) => {
		const current = logos.find((logo) => logo.id === id);
		if (!current) throw notFound();
		return {
			logos: replaceFooterLogo(logos, id, { ...current, is_published: isPublished }) ?? logos,
			attachments
		};
	});
}

export async function moveFooterLogoTo(
	actor: string,
	rev: string,
	id: string,
	direction: FooterLogoDirection
): Promise<void> {
	await mutateConfig(actor, rev, ({ logos, attachments }) => {
		const next = moveFooterLogo(logos, id, direction);
		if (!next) throw notFound();
		return { logos: next, attachments };
	});
}

/** Entry and attachment go in the same PUT (FR-9). */
export async function deleteFooterLogo(actor: string, rev: string, id: string): Promise<void> {
	await mutateConfig(actor, rev, ({ logos, attachments }) => {
		const next = removeFooterLogo(logos, id);
		if (!next) throw notFound();
		const rest = { ...attachments };
		delete rest[footerLogoAttachmentName(id)];
		return { logos: next, attachments: rest };
	});
}

/**
 * Image bytes for the public route. Unpublished logos are served only when `includeUnpublished`
 * (staff preview); otherwise `null` → 404 (FR-14).
 */
export async function getFooterLogoImage(
	id: string,
	{ includeUnpublished = false }: { includeUnpublished?: boolean } = {}
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
	const doc = await readPublicPortalConfig();
	const logo = parseFooterLogos(doc?.footer_logos).find((l) => l.id === id);
	if (!logo || (!logo.is_published && !includeUnpublished)) return null;

	const name = footerLogoAttachmentName(id);
	const res = await adminAttachment(`${CONFIG_PATH}/${encodeURIComponent(name)}`);
	if (res.status === 404) return null;
	if (!res.bytes) {
		throw new ServiceError('INTERNAL', `Could not read footer logo ${id} (${res.status})`);
	}
	return {
		bytes: res.bytes,
		contentType: res.contentType ?? doc?._attachments?.[name]?.content_type ?? 'image/png'
	};
}
