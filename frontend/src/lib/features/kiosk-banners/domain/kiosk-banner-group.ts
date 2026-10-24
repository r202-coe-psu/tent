import { z } from 'zod';
import { makeDocId } from '$lib/db/model';

export const KIOSK_BANNER_GROUP_LIMITS = {
	nameMax: 60,
	descriptionMax: 200
} as const;

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

export const kioskBannerGroupDocSchema = kioskBannerGroupInputSchema.extend({
	_id: z.string().startsWith('kiosk_banner_group:'),
	_rev: z.string().optional(),
	type: z.literal('kiosk_banner_group'),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
});

export type KioskBannerGroupDoc = z.infer<typeof kioskBannerGroupDocSchema>;

export type KioskBannerGroupInput = z.infer<typeof kioskBannerGroupInputSchema>;

export interface KioskBannerGroupContext {
	shelterCode: string;
	createdBy: string;
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
		schema_v: 1,
		shelter_code: ctx.shelterCode,
		name: input.name,
		description: input.description,
		created_at: ts,
		updated_at: ts,
		created_by: ctx.createdBy
	};
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
