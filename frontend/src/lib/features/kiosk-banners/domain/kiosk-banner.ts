import { z } from 'zod';
import { makeDocId } from '$lib/db/model';
import {
	kioskScreenTypeSchema,
	screenTypeOf,
	type KioskScreenType
} from '$lib/features/shared/domain/kiosk-screen';
import { KIOSK_BANNER_IMAGE_MAX_BYTES } from './kiosk-banner-image';

export const KIOSK_BANNER_LIMITS = {
	titleMax: 120,
	captionMax: 200,
	orderMin: 1,
	orderDefault: 1,
	durationMin: 3,
	durationMax: 60,
	durationDefault: 10,
	imageMaxBytes: KIOSK_BANNER_IMAGE_MAX_BYTES
} as const;

export const kioskBannerStatusSchema = z.enum(['active', 'inactive']);

const kioskBannerFieldsSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, 'ระบุหัวข้อแบนเนอร์')
		.max(KIOSK_BANNER_LIMITS.titleMax, 'หัวข้อยาวเกิน 120 ตัวอักษร'),
	caption: z
		.string()
		.trim()
		.max(KIOSK_BANNER_LIMITS.captionMax, 'คำอธิบายยาวเกิน 200 ตัวอักษร')
		.nullish(),
	order: z
		.number()
		.int()
		.min(KIOSK_BANNER_LIMITS.orderMin)
		.default(KIOSK_BANNER_LIMITS.orderDefault),
	duration_sec: z
		.number()
		.int()
		.min(KIOSK_BANNER_LIMITS.durationMin, 'ระยะเวลาต่ำสุด 3 วินาที')
		.max(KIOSK_BANNER_LIMITS.durationMax, 'ระยะเวลาสูงสุด 60 วินาที')
		.default(KIOSK_BANNER_LIMITS.durationDefault),
	start_at: z.string().datetime({ message: 'รูปแบบเวลาเริ่มไม่ถูกต้อง' }),
	end_at: z.string().datetime({ message: 'รูปแบบเวลาสิ้นสุดไม่ถูกต้อง' }),
	status: kioskBannerStatusSchema.default('active'),
	/** Absent on a doc stored before screen types existed = compact. */
	screen_type: kioskScreenTypeSchema.optional(),
	/** Absent on a doc stored before banner groups existed = ungrouped, never fed to a kiosk. */
	group_id: z.string().startsWith('kiosk_banner_group:').optional()
});

type Period = { start_at: string; end_at: string };

const endAfterStart = {
	check: (v: Period) => Date.parse(v.end_at) > Date.parse(v.start_at),
	params: { message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม', path: ['end_at'] }
};

/** `order` is not client input: the server appends on create and keeps it on update. */
export const kioskBannerInputSchema = kioskBannerFieldsSchema
	.omit({ order: true })
	.extend({
		screen_type: kioskScreenTypeSchema.default('compact'),
		group_id: z.string('เลือกกลุ่มแบนเนอร์').startsWith('kiosk_banner_group:', 'เลือกกลุ่มแบนเนอร์')
	})
	.refine(endAfterStart.check, endAfterStart.params);

const kioskBannerEnvelope = {
	_id: z.string().startsWith('kiosk_banner:'),
	_rev: z.string().optional(),
	type: z.literal('kiosk_banner'),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
};

/** v1 predates banner groups: `group_id` stays optional and a v1 banner is ungrouped. */
const kioskBannerDocV1Schema = kioskBannerFieldsSchema
	.extend({ ...kioskBannerEnvelope, schema_v: z.literal(1) })
	.refine(endAfterStart.check, endAfterStart.params);

const kioskBannerDocV2Schema = kioskBannerFieldsSchema
	.extend({
		...kioskBannerEnvelope,
		schema_v: z.literal(2),
		group_id: z.string().startsWith('kiosk_banner_group:')
	})
	.refine(endAfterStart.check, endAfterStart.params);

export const kioskBannerDocSchema = z.discriminatedUnion('schema_v', [
	kioskBannerDocV1Schema,
	kioskBannerDocV2Schema
]);

export type KioskBannerDoc = z.infer<typeof kioskBannerDocSchema>;

export type KioskBannerInput = z.infer<typeof kioskBannerInputSchema>;

export interface KioskBannerContext {
	shelterCode: string;
	createdBy: string;
	/** Assigned by the server (see `nextBannerOrder`), never taken from the client input. */
	order: number;
}

export function createKioskBanner(
	input: KioskBannerInput,
	ctx: KioskBannerContext,
	now: Date = new Date()
): KioskBannerDoc {
	const ts = now.toISOString();
	return {
		_id: makeDocId('kiosk_banner'),
		type: 'kiosk_banner',
		schema_v: 2,
		shelter_code: ctx.shelterCode,
		group_id: input.group_id,
		title: input.title,
		caption: input.caption,
		order: ctx.order,
		duration_sec: input.duration_sec,
		start_at: input.start_at,
		end_at: input.end_at,
		status: input.status,
		screen_type: input.screen_type,
		created_at: ts,
		updated_at: ts,
		created_by: ctx.createdBy
	};
}

/** True when the banner is for this screen type (a doc without one is a compact banner). */
export function matchesScreen(
	banner: { screen_type?: KioskScreenType | null },
	type: KioskScreenType
): boolean {
	return screenTypeOf(banner) === type;
}

/** The banner's group id, or null for an ungrouped (v1) banner. */
export function groupOf(banner: { group_id?: string | null }): string | null {
	return banner.group_id ?? null;
}

/** True when the banner sits in this (group, screen type) slot; an ungrouped banner never does. */
export function matchesSlot(
	banner: { group_id?: string | null; screen_type?: KioskScreenType | null },
	slot: { group_id: string; screen_type: KioskScreenType }
): boolean {
	return banner.group_id === slot.group_id && screenTypeOf(banner) === slot.screen_type;
}

export function isActiveAt(
	banner: Pick<KioskBannerDoc, 'status' | 'start_at' | 'end_at'>,
	now: Date
): boolean {
	const t = now.getTime();
	return (
		banner.status === 'active' && Date.parse(banner.start_at) <= t && t < Date.parse(banner.end_at)
	);
}

type Sortable = Pick<KioskBannerDoc, '_id' | 'order' | 'start_at'>;

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function sortBanners<T extends Sortable>(banners: readonly T[]): T[] {
	return [...banners].sort(
		(a, b) =>
			a.order - b.order ||
			Date.parse(a.start_at) - Date.parse(b.start_at) ||
			compareStrings(a._id, b._id)
	);
}

export function splitByView<T extends Pick<KioskBannerDoc, 'start_at' | 'end_at'>>(
	banners: readonly T[],
	now: Date
): { current: T[]; expired: T[] } {
	const t = now.getTime();
	const current = banners
		.filter((b) => Date.parse(b.end_at) >= t)
		.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
	const expired = banners
		.filter((b) => Date.parse(b.end_at) < t)
		.sort((a, b) => Date.parse(b.end_at) - Date.parse(a.end_at));
	return { current, expired };
}

type OrderSubject = Pick<KioskBannerDoc, '_id' | 'order' | 'end_at'> & {
	group_id?: string | null;
	screen_type?: KioskScreenType | null;
};

/** Same "current" rule as {@link splitByView}: not yet expired. */
const isCurrentAt = (banner: Pick<KioskBannerDoc, 'end_at'>, t: number): boolean =>
	Date.parse(banner.end_at) >= t;

/** `max(order) + 1` among current banners of this (group, screen type) slot; the default when none. */
export function nextBannerOrder(
	banners: readonly Pick<OrderSubject, 'order' | 'end_at' | 'group_id' | 'screen_type'>[],
	slot: { group_id: string; screen_type: KioskScreenType },
	now: Date
): number {
	const t = now.getTime();
	const orders = banners
		.filter((b) => matchesSlot(b, slot) && isCurrentAt(b, t))
		.map((b) => b.order);
	return orders.length ? Math.max(...orders) + 1 : KIOSK_BANNER_LIMITS.orderDefault;
}

/**
 * Rows the reorder page shows for one (group, screen type) slot: current banners (inactive and
 * not-yet-started included), in display order.
 */
export function orderableBanners<
	T extends Sortable &
		Pick<KioskBannerDoc, 'end_at'> & {
			group_id?: string | null;
			screen_type?: KioskScreenType | null;
		}
>(banners: readonly T[], slot: { group_id: string; screen_type: KioskScreenType }, now: Date): T[] {
	const t = now.getTime();
	return sortBanners(banners.filter((b) => matchesSlot(b, slot) && isCurrentAt(b, t)));
}

export type ReorderPlan =
	| { ok: true; changes: { id: string; order: number }[] }
	| { ok: false; reason: 'duplicate' | 'mismatch' };

/**
 * Renumbers `orderedIds` to 1..n and lists only the banners whose order actually changes.
 * Fails when an id repeats or the ids are not exactly the banners being reordered.
 */
export function planReorder(
	current: readonly Pick<KioskBannerDoc, '_id' | 'order'>[],
	orderedIds: readonly string[]
): ReorderPlan {
	const currentOrder = new Map(current.map((b) => [b._id, b.order]));
	if (new Set(orderedIds).size !== orderedIds.length) return { ok: false, reason: 'duplicate' };
	if (orderedIds.length !== currentOrder.size || !orderedIds.every((id) => currentOrder.has(id)))
		return { ok: false, reason: 'mismatch' };
	const changes = orderedIds.flatMap((id, i) =>
		currentOrder.get(id) === i + 1 ? [] : [{ id, order: i + 1 }]
	);
	return { ok: true, changes };
}
