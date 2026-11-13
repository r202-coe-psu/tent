/**
 * RES-005 payload assembly (draft CR M6 §2 "Payload ของ RES-005").
 *
 * The browser sends the cart + contact only; the BFF builds `requester` and `destination` from the
 * shelter master and the session, so a user cannot pick another shelter's identity. Pure
 * TypeScript / Zod — No I/O, No Svelte.
 */
import { z } from 'zod';
import { CONTACT_PHONE_PATTERN, MAX_LINE_QTY } from './central-warehouse.cart';

/** Why a withdrawal cannot be built (BFF answers 422 with this code). */
export class M6PayloadError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'M6PayloadError';
	}
}

const EXTERNAL_REF_MAX = 64;

export const withdrawalLineInputSchema = z.object({
	item_code: z.string().trim().min(1).max(120),
	name: z.string().trim().min(1).max(300),
	unit: z.string().trim().min(1).max(60),
	type_code: z.string().trim().max(60).nullish(),
	qty: z
		.number()
		.int('จำนวนต้องเป็นจำนวนเต็ม')
		.min(1, 'จำนวนต้องตั้งแต่ 1 ขึ้นไป')
		.max(MAX_LINE_QTY, 'จำนวนมากเกินไป')
});

/** Body of `POST /api/back-office/central-warehouse/withdrawals`. */
export const withdrawalCreateInputSchema = z.object({
	source_warehouse_code: z.string().trim().min(1, 'กรุณาเลือกคลังต้นทาง').max(60),
	source_warehouse_name: z.string().trim().max(300).nullish(),
	reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการเบิก').max(2000),
	contact_role: z.string().trim().min(1, 'กรุณาระบุตำแหน่งผู้ติดต่อ').max(60),
	contact_phone: z
		.string()
		.trim()
		.regex(CONTACT_PHONE_PATTERN, 'กรุณาระบุเบอร์โทรผู้ติดต่อให้ถูกต้อง'),
	lines: z
		.array(withdrawalLineInputSchema)
		.min(1, 'กรุณาเลือกของอย่างน้อย 1 รายการ')
		.max(200)
		.refine((ls) => new Set(ls.map((l) => l.item_code)).size === ls.length, {
			message: 'มีรายการซ้ำในตะกร้า'
		})
});
export type WithdrawalCreateInput = z.infer<typeof withdrawalCreateInputSchema>;

export type M6ShelterSource = {
	code: string;
	name: string;
	location?: { address?: string | null; lat?: number | null; lng?: number | null } | null;
};

export type M6Actor = { name: string; username: string };

/** `TENT-{shelter_code}-{ulid}` — M6's idempotency key for the request. */
export function externalRefFor(shelterCode: string, id: string): string {
	const ref = `TENT-${shelterCode}-${id}`;
	if (ref.length > EXTERNAL_REF_MAX) {
		throw new M6PayloadError('EXTERNAL_REF_TOO_LONG', `external_ref exceeds ${EXTERNAL_REF_MAX}`);
	}
	return ref;
}

/** Body FastAPI `POST /v1/integrations/m6/withdrawals` takes (CONTRACT.md). */
export type M6WithdrawalPayload = {
	shelter_code: string;
	external_ref: string;
	source_warehouse_code: string;
	source_warehouse_name: string | null;
	requester: {
		location_code: string;
		location_type: 'shelter';
		location_name: string;
		contact_name: string;
		contact_role: string;
		contact_phone: string;
		external_ref: string;
	};
	destination: {
		location_code: string;
		name: string;
		type: 'shelter';
		lat: number;
		lng: number;
		address: string;
	};
	reason: string;
	lines: { item_code: string; name: string; unit: string; type_code?: string; qty: number }[];
	actor: M6Actor;
};

/**
 * @throws {M6PayloadError} `SHELTER_LOCATION_MISSING` when the shelter has no coordinates or
 * address — M6 needs a destination, so staff must set the shelter location first.
 */
export function buildM6WithdrawalPayload(input: {
	input: WithdrawalCreateInput;
	shelter: M6ShelterSource;
	/** Display name of the signed-in user (`requester.contact_name`). */
	contactName: string;
	actor: M6Actor;
	externalRef: string;
}): M6WithdrawalPayload {
	const { input: body, shelter, contactName, actor, externalRef } = input;
	const lat = shelter.location?.lat;
	const lng = shelter.location?.lng;
	const address = shelter.location?.address?.trim();
	if (
		typeof lat !== 'number' ||
		typeof lng !== 'number' ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lng) ||
		(lat === 0 && lng === 0) ||
		!address
	) {
		throw new M6PayloadError(
			'SHELTER_LOCATION_MISSING',
			'ศูนย์นี้ยังไม่ได้ตั้งพิกัดหรือที่อยู่ กรุณาตั้งค่าตำแหน่งศูนย์ที่เมนู "จัดการศูนย์พักพิง" ก่อนขอเบิกจากคลังกลาง'
		);
	}
	return {
		shelter_code: shelter.code,
		external_ref: externalRef,
		source_warehouse_code: body.source_warehouse_code,
		source_warehouse_name: body.source_warehouse_name?.trim() || null,
		requester: {
			location_code: shelter.code,
			location_type: 'shelter',
			location_name: shelter.name,
			contact_name: contactName,
			contact_role: body.contact_role,
			contact_phone: body.contact_phone,
			external_ref: externalRef
		},
		destination: {
			location_code: shelter.code,
			name: shelter.name,
			type: 'shelter',
			lat,
			lng,
			address
		},
		reason: body.reason,
		lines: body.lines.map((l) => ({
			item_code: l.item_code,
			name: l.name,
			unit: l.unit,
			...(l.type_code ? { type_code: l.type_code } : {}),
			qty: l.qty
		})),
		actor
	};
}

export const cancelBodySchema = z.object({
	reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ยกเลิก').max(2000)
});
