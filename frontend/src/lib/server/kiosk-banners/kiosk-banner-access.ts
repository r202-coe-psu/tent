import { json } from '@sveltejs/kit';
import { SCANNER_MANAGER_CAPABILITIES } from '$lib/auth/roles';
import { serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	callerCanManage,
	requireShelterCapabilityCaller,
	type ScopedCaller
} from '$lib/server/shelter-capability-access';
import {
	decodeBannerImage,
	kioskBannerInputSchema,
	type KioskBannerInput
} from '$lib/features/kiosk-banners';
import { z } from 'zod';
import {
	BannerNotFoundError,
	getBanner,
	GroupNotFoundError,
	type DecodedBannerImage,
	type KioskBannerRecord
} from './kiosk-banner.server';
import { makeDocId } from '$lib/db/model';
import { getGroup, type KioskBannerGroupRecord } from './kiosk-banner-group.server';

/** Resolve the caller of a banner admin route: SA, or a shelter_manager / kiosk_staff of any shelter (FR-KBR-10). */
export function requireBannerManager(request: Request): Promise<ScopedCaller> {
	return requireShelterCapabilityCaller(
		request.headers.get('cookie'),
		SCANNER_MANAGER_CAPABILITIES
	);
}

/** A banner outside the caller's scope reads as missing (FR-KBR-12). */
export function assertBannerInScope(caller: ScopedCaller, banner: { shelter_code: string }): void {
	if (!callerCanManage(caller, [banner.shelter_code])) {
		throw new BannerNotFoundError('out-of-scope');
	}
}

/**
 * Load the banner for an `[id]` path param and require it in the caller's scope. The param is
 * always namespaced to `kiosk_banner:`, so another doc type in `registry` reads as missing.
 */
export async function loadBannerInScope(
	caller: ScopedCaller,
	idParam: string
): Promise<KioskBannerRecord> {
	const docId = makeDocId('kiosk_banner', idParam);
	const banner = await getBanner(docId);
	if (!banner) throw new BannerNotFoundError(docId);
	assertBannerInScope(caller, banner);
	return banner;
}

/**
 * Load the group for an `[id]` path param and require it in the caller's scope. The param is
 * always namespaced to `kiosk_banner_group:`, so another doc type in `registry` reads as missing.
 */
export async function loadGroupInScope(
	caller: ScopedCaller,
	idParam: string
): Promise<KioskBannerGroupRecord> {
	const docId = makeDocId('kiosk_banner_group', idParam);
	const group = await getGroup(docId);
	if (!group || !callerCanManage(caller, [group.shelter_code])) {
		throw new GroupNotFoundError(docId);
	}
	return group;
}

/** A banner's `group_id` must name a group of the banner's own shelter. */
export async function assertGroupInShelter(groupId: string, shelterCode: string): Promise<void> {
	const group = await getGroup(groupId);
	if (!group || group.shelter_code !== shelterCode) {
		throw new ServiceError('VALIDATION', 'ไม่พบกลุ่มแบนเนอร์ในศูนย์นี้');
	}
}

/** The shelter the caller chose for list / create is 403 when outside scope (FR-KBR-11). */
export function assertCanManageShelter(caller: ScopedCaller, shelterCode: string): void {
	if (!callerCanManage(caller, [shelterCode])) {
		throw new ServiceError('FORBIDDEN', 'Not a shelter_manager or kiosk_staff of this shelter');
	}
}

/** The `shelter_code` query param of a list / create route; missing is `422` (FR-KBR-11). */
export function requireShelterCode(url: URL): string {
	const shelterCode = url.searchParams.get('shelter_code');
	if (!shelterCode) throw new ServiceError('VALIDATION', 'shelter_code is required');
	return shelterCode;
}

/** Parse a request body against a strict schema; the first issue's message is the `422` text. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid request body');
	}
	return parsed.data;
}

/** Map a thrown error to the contract envelope; a missing banner or group is `404 NOT_FOUND`. */
export function bannerErrorResponse(error: unknown): Response {
	if (error instanceof BannerNotFoundError) {
		const message =
			error instanceof GroupNotFoundError ? 'Banner group not found' : 'Banner not found';
		return json({ error: { code: 'NOT_FOUND', message } }, { status: 404 });
	}
	return serviceError(error);
}

const IMAGE_MESSAGES = {
	empty: 'ไม่พบข้อมูลรูปภาพ',
	invalid_base64: 'ข้อมูลรูปภาพไม่ถูกต้อง',
	too_large: 'รูปภาพต้องมีขนาดไม่เกิน 2 MB',
	unsupported_type: 'รองรับเฉพาะรูป png / jpeg / webp'
} as const;

const imagePayloadSchema = z.object({ content_type: z.string(), data_base64: z.string() });

/** Validate and decode the `image` field (FR-KBR-04); any failure is `422` with a Thai message. */
export function decodeImageField(raw: unknown): DecodedBannerImage {
	const payload = imagePayloadSchema.safeParse(raw);
	if (!payload.success) throw new ServiceError('VALIDATION', 'ข้อมูลรูปภาพไม่ถูกต้อง');
	const decoded = decodeBannerImage(payload.data);
	if (!decoded.ok) throw new ServiceError('VALIDATION', IMAGE_MESSAGES[decoded.reason]);
	return { bytes: decoded.bytes, contentType: decoded.contentType };
}

/** Read a JSON object body; anything else is `422`. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	const body: unknown = await request.json().catch(() => null);
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new ServiceError('VALIDATION', 'Request body must be a JSON object');
	}
	return body as Record<string, unknown>;
}

/** `shelter_code` is set once from the request query and never taken from a body (FR-KBR-02). */
export function assertNoShelterCode(body: Record<string, unknown>): void {
	if ('shelter_code' in body) {
		throw new ServiceError('VALIDATION', 'shelter_code must not be in the request body');
	}
}

/** Editable banner fields from a body whose non-field keys (`image`, `_rev`) were already split off. */
export function parseBannerInput(fields: Record<string, unknown>): KioskBannerInput {
	const parsed = kioskBannerInputSchema.safeParse(fields);
	if (!parsed.success) {
		throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid banner');
	}
	return parsed.data;
}
