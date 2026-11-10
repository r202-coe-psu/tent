import { z } from 'zod';
import { makeDocId } from '$lib/db/model';

export const KIOSK_BANNER_GROUP_LIMITS = {
	nameMax: 60,
	descriptionMax: 200
} as const;

/** The code typed on a TV to pair it with a group: six ASCII digits, leading zeros kept. */
export const tvCodeSchema = z.string().regex(/^[0-9]{6}$/);

/** Largest multiple of 1,000,000 below 2^32: values at or above it would bias the modulo. */
const TV_CODE_UNBIASED_LIMIT = 4_294_000_000;

/** Draws a random six-digit tv code. `fill` is injectable so tests can supply fixed bytes. */
export function generateTvCode(
	fill: (arr: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer> = (arr) =>
		crypto.getRandomValues(arr)
): string {
	const buf = new Uint32Array(new ArrayBuffer(4));
	do {
		fill(buf);
	} while (buf[0] >= TV_CODE_UNBIASED_LIMIT);
	return String(buf[0] % 1_000_000).padStart(6, '0');
}

export const kioskBannerGroupInputSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'ระบุชื่อกลุ่ม')
		.max(KIOSK_BANNER_GROUP_LIMITS.nameMax, 'ชื่อกลุ่มยาวเกิน 60 ตัวอักษร'),
	description: z
		.string()
		.trim()
		.max(KIOSK_BANNER_GROUP_LIMITS.descriptionMax, 'คำอธิบายยาวเกิน 200 ตัวอักษร')
		.nullish()
});

const kioskBannerGroupEnvelope = {
	_id: z.string().startsWith('kiosk_banner_group:'),
	_rev: z.string().optional(),
	type: z.literal('kiosk_banner_group'),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
};

/** v1 predates the TV pairing code: a v1 group has no `tv_code` until the server backfills it. */
const kioskBannerGroupDocV1Schema = kioskBannerGroupInputSchema.extend({
	...kioskBannerGroupEnvelope,
	schema_v: z.literal(1)
});

const kioskBannerGroupDocV2Schema = kioskBannerGroupInputSchema.extend({
	...kioskBannerGroupEnvelope,
	schema_v: z.literal(2),
	tv_code: tvCodeSchema
});

export const kioskBannerGroupDocSchema = z.discriminatedUnion('schema_v', [
	kioskBannerGroupDocV1Schema,
	kioskBannerGroupDocV2Schema
]);

export type KioskBannerGroupDoc = z.infer<typeof kioskBannerGroupDocSchema>;

export type KioskBannerGroupInput = z.infer<typeof kioskBannerGroupInputSchema>;

export interface KioskBannerGroupContext {
	shelterCode: string;
	createdBy: string;
	/** Issued by the server (random, system-wide unique), never taken from the client input. */
	tvCode: string;
}

export function createKioskBannerGroup(
	input: KioskBannerGroupInput,
	ctx: KioskBannerGroupContext,
	now: Date = new Date()
): KioskBannerGroupDoc {
	const ts = now.toISOString();
	return {
		_id: makeDocId('kiosk_banner_group'),
		type: 'kiosk_banner_group',
		schema_v: 2,
		tv_code: ctx.tvCode,
		shelter_code: ctx.shelterCode,
		name: input.name,
		description: input.description,
		created_at: ts,
		updated_at: ts,
		created_by: ctx.createdBy
	};
}

/** True for a v1 group, which has no `tv_code` yet and is due for the server's lazy backfill. */
export function needsTvCode(doc: Pick<KioskBannerGroupDoc, 'schema_v'>): boolean {
	return doc.schema_v === 1;
}

const nameKey = (name: string): string => name.trim().toLowerCase();

/** True when another group (not `exceptId`) already has this name, ignoring case and spacing. */
export function isDuplicateGroupName(
	groups: readonly Pick<KioskBannerGroupDoc, '_id' | 'name'>[],
	name: string,
	exceptId?: string
): boolean {
	const key = nameKey(name);
	return groups.some((g) => g._id !== exceptId && nameKey(g.name) === key);
}
