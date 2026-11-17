import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import {
	TEMPLATE_IMAGE_ATTACHMENT,
	createKioskBanner,
	groupOf,
	isActiveAt,
	matchesSlot,
	nextBannerOrder,
	orderableBanners,
	planReorder,
	sortBanners,
	type KioskBannerContext,
	type KioskBannerDoc,
	type KioskBannerImageMime,
	type KioskBannerInput,
	type KioskBannerTemplate
} from '$lib/features/kiosk-banners';
import { screenTypeOf, type KioskScreenType } from '$lib/features/shared';

const REGISTRY_DB = 'registry';
const IMAGE_ATTACHMENT = 'image';

export interface DecodedBannerImage {
	bytes: Uint8Array;
	contentType: KioskBannerImageMime;
}

/** Uploaded files of a banner; `templateImage` is the logo of a template banner. */
export interface BannerFiles {
	image: DecodedBannerImage | null;
	templateImage?: DecodedBannerImage | null;
}

/** Banner doc plus the image content type; raw `_attachments` never leaves this module. */
export type KioskBannerRecord = KioskBannerDoc & { image_content_type: string | null };

type AttachmentStub = {
	stub: true;
	content_type: string;
	length?: number;
	digest?: string;
};
type InlineAttachment = { content_type: string; data: string };
type RawBannerDoc = KioskBannerDoc & {
	_attachments?: Record<string, AttachmentStub>;
};

/** Banner doc does not exist (CouchDB 404). `ServiceErrorCode` has no NOT_FOUND, so a typed error. */
export class BannerNotFoundError extends Error {
	readonly code = 'NOT_FOUND' as const;
	constructor(readonly id: string) {
		super(`Banner ${id} not found`);
		this.name = 'BannerNotFoundError';
	}
}

/** Banner group doc does not exist; still a `BannerNotFoundError`, so every route maps it to 404. */
export class GroupNotFoundError extends BannerNotFoundError {
	constructor(id: string) {
		super(id);
		this.message = `Banner group ${id} not found`;
		this.name = 'GroupNotFoundError';
	}
}

const docPath = (id: string): string => `/${REGISTRY_DB}/${encodeURIComponent(id)}`;

function toInline(image: DecodedBannerImage): InlineAttachment {
	return { content_type: image.contentType, data: Buffer.from(image.bytes).toString('base64') };
}

function toRecord(doc: RawBannerDoc): KioskBannerRecord {
	const { _attachments, ...rest } = doc;
	return { ...rest, image_content_type: _attachments?.[IMAGE_ATTACHMENT]?.content_type ?? null };
}

function couchDetail(data: unknown): string {
	const d = (data as { reason?: string; error?: string } | null) ?? {};
	return d.reason ?? d.error ?? 'unknown';
}

async function putDoc(
	doc: KioskBannerDoc,
	attachments: Record<string, InlineAttachment | AttachmentStub>
): Promise<KioskBannerRecord> {
	const res = await adminRaw(docPath(doc._id), 'PUT', { ...doc, _attachments: attachments });
	if (res.status === 409) throw new ServiceError('CONFLICT', 'Banner was modified by someone else');
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not save banner ${doc._id} (${res.status}): ${couchDetail(res.data)}`
		);
	}
	const { rev } = res.data as { rev: string };
	const attachment = attachments[IMAGE_ATTACHMENT];
	return { ...doc, _rev: rev, image_content_type: attachment?.content_type ?? null };
}

const referencesTemplateImage = (template: KioskBannerTemplate | undefined): boolean =>
	template?.image === TEMPLATE_IMAGE_ATTACHMENT;

/** A logo is required exactly when the template references it; `stored` = already on the doc. */
function assertTemplateImage(
	template: KioskBannerTemplate | undefined,
	sent: boolean,
	stored: boolean
): void {
	const referenced = referencesTemplateImage(template);
	if (sent && !referenced) {
		throw new ServiceError('VALIDATION', 'รูปในประกาศใช้ได้เฉพาะประกาศที่มีรูปในแม่แบบ');
	}
	if (referenced && !sent && !stored) throw new ServiceError('VALIDATION', 'เลือกรูปในประกาศ');
}

export async function createBanner(
	input: KioskBannerInput,
	files: { image: DecodedBannerImage; templateImage?: DecodedBannerImage | null },
	ctx: Omit<KioskBannerContext, 'order'>,
	now: Date = new Date()
): Promise<KioskBannerRecord> {
	assertTemplateImage(input.template, !!files.templateImage, false);
	const banners = await findRawBanners(ctx.shelterCode);
	const order = nextBannerOrder(
		banners,
		{ group_id: input.group_id, screen_type: input.screen_type },
		now
	);
	const doc = createKioskBanner(input, { ...ctx, order }, now);
	return putDoc(doc, {
		[IMAGE_ATTACHMENT]: toInline(files.image),
		...(files.templateImage ? { [TEMPLATE_IMAGE_ATTACHMENT]: toInline(files.templateImage) } : {})
	});
}

async function readRaw(id: string): Promise<RawBannerDoc> {
	const res = await adminRaw(docPath(id), 'GET');
	if (res.status === 404) throw new BannerNotFoundError(id);
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read banner ${id} (${res.status})`);
	}
	return res.data as RawBannerDoc;
}

/** Fields a mutation may set; `schema_v`/`group_id` are the only ones that differ across versions. */
type BannerPatch = Partial<Omit<KioskBannerDoc, 'schema_v' | 'group_id'>> & {
	schema_v?: 4;
	group_id?: string;
	template?: KioskBannerTemplate;
};

/**
 * `files` null keeps every stored attachment. Otherwise a new file replaces its slot, and the stored
 * `template_image` survives only while the new doc's template still references it.
 */
function mergeAttachments(
	stored: Record<string, AttachmentStub> | undefined,
	files: BannerFiles | null,
	template: KioskBannerTemplate | undefined
): Record<string, InlineAttachment | AttachmentStub> {
	if (!files) return stored ?? {};
	const { [TEMPLATE_IMAGE_ATTACHMENT]: storedLogo, ...rest } = stored ?? {};
	const logo = files.templateImage ? toInline(files.templateImage) : storedLogo;
	return {
		...rest,
		...(files.image ? { [IMAGE_ATTACHMENT]: toInline(files.image) } : {}),
		...(referencesTemplateImage(template) && logo ? { [TEMPLATE_IMAGE_ATTACHMENT]: logo } : {})
	};
}

async function mutate(
	id: string,
	rev: string,
	change: (current: RawBannerDoc) => BannerPatch | Promise<BannerPatch>,
	files: BannerFiles | null,
	now: Date
): Promise<KioskBannerRecord> {
	const current = await readRaw(id);
	if (current._rev !== rev) {
		throw new ServiceError('CONFLICT', 'Banner was modified by someone else');
	}
	const { _attachments, ...kept } = current;
	const patch = await change(current);
	const doc = { ...kept, ...patch, updated_at: now.toISOString() } as KioskBannerDoc & {
		template?: KioskBannerTemplate;
	};
	// A patch that sets `template: undefined` (an edit back to an uploaded image) drops the old one.
	if ('template' in patch && patch.template === undefined) delete doc.template;
	return putDoc(doc, mergeAttachments(_attachments, files, doc.template));
}

export function updateBanner(
	id: string,
	rev: string,
	input: KioskBannerInput,
	files: BannerFiles,
	now: Date = new Date()
): Promise<KioskBannerRecord> {
	const { title, caption, duration_sec, start_at, end_at, status, screen_type, group_id } = input;
	return mutate(
		id,
		rev,
		async (current) => {
			assertTemplateImage(
				input.template,
				!!files.templateImage,
				!!current._attachments?.[TEMPLATE_IMAGE_ATTACHMENT]
			);
			return {
				title,
				caption,
				duration_sec,
				start_at,
				end_at,
				status,
				screen_type,
				group_id,
				// Editing a v1, v2 or v3 banner always writes it back as v4.
				schema_v: 4,
				// Order is only set by the reorder page; a banner moved to another group or screen goes to
				// the end of that slot.
				order:
					groupOf(current) === group_id && screenTypeOf(current) === screen_type
						? current.order
						: nextBannerOrder(
								await findRawBanners(current.shelter_code),
								{ group_id, screen_type },
								now
							),
				template: input.template
			};
		},
		files,
		now
	);
}

export function setBannerStatus(
	id: string,
	rev: string,
	status: KioskBannerDoc['status'],
	now: Date = new Date()
): Promise<KioskBannerRecord> {
	return mutate(id, rev, () => ({ status }), null, now);
}

export async function getBanner(id: string): Promise<KioskBannerRecord | null> {
	const res = await adminRaw(docPath(id), 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read banner ${id} (${res.status})`);
	}
	return toRecord(res.data as RawBannerDoc);
}

export async function deleteBanner(id: string, rev: string): Promise<void> {
	const res = await adminRaw(`${docPath(id)}?rev=${encodeURIComponent(rev)}`, 'DELETE');
	if (res.status === 404) throw new BannerNotFoundError(id);
	if (res.status === 409) throw new ServiceError('CONFLICT', 'Banner was modified by someone else');
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not delete banner ${id} (${res.status}): ${couchDetail(res.data)}`
		);
	}
}

const LIST_LIMIT = 500;
const ACTIVE_CAP = 20;

/** Served by `KIOSK_BANNER_MANGO_INDEX` (registry-design), deployed by `pnpm db:sync`. */
async function findRawBanners(shelterCode: string): Promise<RawBannerDoc[]> {
	const res = await adminRaw(`/${REGISTRY_DB}/_find`, 'POST', {
		selector: { type: 'kiosk_banner', shelter_code: shelterCode },
		limit: LIST_LIMIT
	});
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not list banners (${res.status}): ${couchDetail(res.data)}`
		);
	}
	return (res.data as { docs: RawBannerDoc[] }).docs;
}

export async function listBannersForShelter(shelterCode: string): Promise<KioskBannerRecord[]> {
	return (await findRawBanners(shelterCode)).map(toRecord);
}

/**
 * Renumber the current banners of one (group, screen type) slot to the given order (1..n); only changed
 * banners are written, with their `_attachments` stubs kept so CouchDB does not drop the image.
 */
export async function reorderBanners(
	shelterCode: string,
	slot: { groupId: string; screenType: KioskScreenType },
	items: { id: string; rev: string }[],
	now: Date = new Date()
): Promise<KioskBannerRecord[]> {
	const orderable = orderableBanners(
		await findRawBanners(shelterCode),
		{ group_id: slot.groupId, screen_type: slot.screenType },
		now
	);
	const plan = planReorder(
		orderable,
		items.map((i) => i.id)
	);
	if (!plan.ok) {
		throw plan.reason === 'duplicate'
			? new ServiceError('VALIDATION', 'Banner ids must not repeat')
			: new ServiceError('CONFLICT', 'Banner list changed, reload and try again');
	}
	const revs = new Map(orderable.map((b) => [b._id, b._rev]));
	if (items.some((i) => revs.get(i.id) !== i.rev)) {
		throw new ServiceError('CONFLICT', 'Banner was modified by someone else');
	}
	const newOrder = new Map(plan.changes.map((c) => [c.id, c.order]));
	const docs = orderable
		.filter((b) => newOrder.has(b._id))
		.map((b) => ({ ...b, order: newOrder.get(b._id)!, updated_at: now.toISOString() }));
	const newRevs = docs.length ? await bulkWrite(docs) : new Map<string, string>();
	return sortBanners(
		orderable.map((b) =>
			newOrder.has(b._id)
				? toRecord({
						...b,
						order: newOrder.get(b._id)!,
						_rev: newRevs.get(b._id) ?? b._rev,
						updated_at: now.toISOString()
					})
				: toRecord(b)
		)
	);
}

type BulkRow = { id: string; ok?: boolean; rev?: string; error?: string };

/** `_bulk_docs` answers per row and is not atomic: a failed row can leave the others written. */
async function bulkWrite(docs: RawBannerDoc[]): Promise<Map<string, string>> {
	const res = await adminRaw(`/${REGISTRY_DB}/_bulk_docs`, 'POST', { docs });
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not reorder banners (${res.status}): ${couchDetail(res.data)}`
		);
	}
	const rows = res.data as BulkRow[];
	if (rows.some((r) => r.error === 'conflict')) {
		throw new ServiceError('CONFLICT', 'Banner was modified by someone else');
	}
	const failed = rows.find((r) => r.error);
	if (failed) {
		throw new ServiceError('INTERNAL', `Could not reorder banner ${failed.id}: ${failed.error}`);
	}
	return new Map(rows.flatMap((r) => (r.rev ? [[r.id, r.rev] as const] : [])));
}

export async function listActiveForShelter(
	shelterCode: string,
	now: Date,
	slot: { groupId: string; screenType: KioskScreenType }
): Promise<KioskBannerRecord[]> {
	const all = await listBannersForShelter(shelterCode);
	const inSlot = { group_id: slot.groupId, screen_type: slot.screenType };
	return sortBanners(all.filter((b) => matchesSlot(b, inSlot) && isActiveAt(b, now))).slice(
		0,
		ACTIVE_CAP
	);
}

async function readAttachment(
	id: string,
	name: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
	const res = await adminRaw(`${docPath(id)}?attachments=true`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read banner image ${id} (${res.status})`);
	}
	const image = (
		res.data as { _attachments?: Record<string, { content_type: string; data?: string }> }
	)._attachments?.[name];
	if (!image?.data) return null;
	const buf = Buffer.from(image.data, 'base64');
	return {
		bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
		contentType: image.content_type
	};
}

export const getBannerImage = (id: string) => readAttachment(id, IMAGE_ATTACHMENT);

export const getBannerTemplateImage = (id: string) => readAttachment(id, TEMPLATE_IMAGE_ATTACHMENT);
