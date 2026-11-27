import { z } from 'zod';
import { qtyGt } from '$lib/utils/qty';
import { isPositiveQty } from './positive-qty';

/**
 * Zod rules for the create / edit campaign forms (superforms, `zod4Client`).
 *
 * Rules that only read the typed value live here as plain refinements. Three rules read
 * RUNTIME data that is still loading or changes under the form (the catalog row's unit, the
 * UOM master, the shelter's drop-off points), so each schema is a factory taking a small
 * `env` of getters the component supplies. The getters are read when validation runs, so the
 * schema never holds a stale copy and can be tested with plain stubs.
 */

export const CAMPAIGN_URGENCIES = ['critical', 'important', 'normal'] as const;
export type CampaignUrgency = (typeof CAMPAIGN_URGENCIES)[number];

export const CAMPAIGN_FORM_MESSAGES = {
	item: 'กรุณาเลือกรายการสิ่งของจากแคตตาล็อก',
	itemNoUnit: 'รายการนี้ยังไม่มีหน่วยฐานในแคตตาล็อก — กรุณาตั้งหน่วยที่ Item Master ก่อน',
	itemUnknownUnit: (unit: string) =>
		`หน่วย "${unit}" ของรายการนี้ไม่อยู่ในรายการหน่วยนับ — กรุณาแก้หน่วยที่ Item Master ก่อน`,
	title: 'กรุณาระบุชื่อประกาศ',
	targetMissing: 'กรุณาระบุจำนวนเป้าหมาย',
	targetNotPositive: 'จำนวนเป้าหมายต้องเป็นตัวเลขมากกว่า 0',
	belowPledged: (pledged: string, unit: string) =>
		`ตั้งเป้าต่ำกว่ายอดที่ผู้บริจาคจองไว้แล้ว (${pledged} ${unit}) ไม่ได้`,
	point: 'กรุณาเลือกจุดรับบริจาค',
	description: 'กรุณาระบุเหตุผลหรือรายละเอียดเพิ่มเติม'
} as const;

/**
 * True when a valid target sits BELOW what donors already pledged. Lowering to exactly the
 * pledged figure is allowed (the need goes full); anything lower would leave
 * `reserved_qty <= qty_target` false for bookings that are still owed.
 */
export function isTargetBelowPledged(target: string, pledged: string): boolean {
	return !!target.trim() && isPositiveQty(target) && qtyGt(pledged, target);
}

/** What the catalog says about a picked item; `undefined` = no such row. */
export type CampaignCatalogItem = {
	/** Trimmed `base_unit` as stored — may be a legacy label, or '' when the row has none. */
	unit: string;
	/** `unit` resolved to a UOM code, or `null` when the UOM master does not know it. */
	unitCode: string | null;
};

export type CreateCampaignFormEnv = {
	lookupItem: (itemId: string) => CampaignCatalogItem | undefined;
	/** True once a drop-off point is settled for what staff chose ('' = nothing chosen yet). */
	pointReady: (chosen: string) => boolean;
};

export type EditCampaignFormEnv = {
	/** What donors already pledged against the need, as a qty string. */
	pledged: string;
	/** The unit shown in the below-pledged message (read at validation time). */
	unitLabel: () => string;
	pointReady: (chosen: string) => boolean;
};

const urgencySchema = z.enum(CAMPAIGN_URGENCIES);

function pointSchema(pointReady: (chosen: string) => boolean) {
	return z.string().refine(pointReady, CAMPAIGN_FORM_MESSAGES.point);
}

/** One message per failure: missing, then not a positive number, then (edit only) below pledged. */
function targetSchema(pledged?: { qty: string; unitLabel: () => string }) {
	return z.string().superRefine((value, ctx) => {
		const message = !value.trim()
			? CAMPAIGN_FORM_MESSAGES.targetMissing
			: !isPositiveQty(value)
				? CAMPAIGN_FORM_MESSAGES.targetNotPositive
				: pledged && isTargetBelowPledged(value, pledged.qty)
					? CAMPAIGN_FORM_MESSAGES.belowPledged(pledged.qty, pledged.unitLabel())
					: null;
		if (message) ctx.addIssue({ code: 'custom', message });
	});
}

export function createCampaignFormSchema(env: CreateCampaignFormEnv) {
	return z.object({
		itemId: z.string().superRefine((itemId, ctx) => {
			const item = env.lookupItem(itemId);
			const message = !item
				? CAMPAIGN_FORM_MESSAGES.item
				: !item.unit
					? CAMPAIGN_FORM_MESSAGES.itemNoUnit
					: !item.unitCode
						? CAMPAIGN_FORM_MESSAGES.itemUnknownUnit(item.unit)
						: null;
			if (message) ctx.addIssue({ code: 'custom', message });
		}),
		target: targetSchema(),
		urgency: urgencySchema,
		dropOffPointId: pointSchema(env.pointReady),
		description: z.string().trim().min(1, CAMPAIGN_FORM_MESSAGES.description)
	});
}
export type CreateCampaignFormValues = z.input<ReturnType<typeof createCampaignFormSchema>>;

export function editCampaignFormSchema(env: EditCampaignFormEnv) {
	return z.object({
		title: z.string().trim().min(1, CAMPAIGN_FORM_MESSAGES.title),
		category: z.string(),
		target: targetSchema({ qty: env.pledged, unitLabel: env.unitLabel }),
		urgency: urgencySchema,
		dropOffPointId: pointSchema(env.pointReady),
		description: z.string()
	});
}
export type EditCampaignFormValues = z.input<ReturnType<typeof editCampaignFormSchema>>;
