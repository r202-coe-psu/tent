import { z } from 'zod';
import { THAI_MOBILE_PHONE_MESSAGE, thaiMobilePhoneSchema } from '$lib/db/model';
import { isPositiveQty } from './positive-qty';

/**
 * Zod rules for the scan station's walk-in intake form (superforms, `zod4Client`).
 *
 * Only `isPerishable` reads runtime data (the catalog row's `requiresExpiry`), so the schema
 * is a factory taking it as a getter. The whole-quantity rule for units that cannot be split
 * is NOT here: it depends on the unit-dimension resolver, must show while typing (before the
 * first save) and disables the Save button, so the component keeps it as a live derived check.
 */

export const WALKIN_FORM_MESSAGES = {
	name: 'กรุณาระบุชื่อผู้บริจาค',
	phone: THAI_MOBILE_PHONE_MESSAGE,
	noItem: 'กรุณาเลือกรายการสิ่งของอย่างน้อย 1 รายการ',
	qty: 'กรุณาระบุจำนวนที่รับจริง (มากกว่า 0)',
	expiry: 'ของเน่าเสียง่ายต้องระบุวันหมดอายุ'
} as const;

export type WalkinFormEnv = {
	isPerishable: (itemId: string) => boolean;
};

export type WalkinLine = {
	/** Stable key for the `{#each}` block and the element ids. */
	id: string;
	/** Picked catalog id; '' = line not filled in (it is dropped on save). */
	itemId: string;
	name: string;
	/** Qty as a string (CR decimal rule) — never a number. */
	qty: string;
	unit: string;
	expiry: string;
	/** Chosen storage point id; '' = main store. */
	storagePointId: string;
};

export type WalkinFormValues = {
	name: string;
	phone: string;
	email: string;
	items: WalkinLine[];
};

export function walkinFormSchema(env: WalkinFormEnv) {
	const line = z
		.object({
			id: z.string(),
			itemId: z.string(),
			name: z.string(),
			qty: z.string(),
			unit: z.string(),
			expiry: z.string(),
			storagePointId: z.string()
		})
		.superRefine((it, ctx) => {
			// A line with no item is an empty row, not a mistake; only a picked item needs a count.
			if (!it.itemId) return;
			if (!isPositiveQty(it.qty || '0')) {
				ctx.addIssue({ code: 'custom', path: ['qty'], message: WALKIN_FORM_MESSAGES.qty });
			}
			// schema.md §2.1: a perishable lot with no expiry cannot be rotated or discarded in time.
			if (env.isPerishable(it.itemId) && !it.expiry.trim()) {
				ctx.addIssue({ code: 'custom', path: ['expiry'], message: WALKIN_FORM_MESSAGES.expiry });
			}
		});

	return z.object({
		name: z.string().trim().min(1, WALKIN_FORM_MESSAGES.name),
		// Same rule the BFF enforces (it stays the authority). Empty is fine — the phone is optional.
		// A refine, not `thaiMobilePhoneSchema` itself: its transform would rewrite the typed value.
		phone: z.string().refine((v) => thaiMobilePhoneSchema.safeParse(v).success, {
			message: WALKIN_FORM_MESSAGES.phone
		}),
		email: z.string(),
		// Pinned to the first line's item picker: superforms keeps a plain error on an array as a
		// bare string list, which collides with the per-line errors, but a leaf error is clean.
		items: z.array(line).superRefine((items, ctx) => {
			if (!items.some((it) => it.itemId)) {
				ctx.addIssue({ code: 'custom', path: [0, 'itemId'], message: WALKIN_FORM_MESSAGES.noItem });
			}
		})
	});
}
