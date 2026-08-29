import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc, type Timestamp } from '$lib/db/model';

/**
 * `donation_redirect:{ulid}` — the ticket a shelter receives when another shelter
 * hands it a donation request it cannot take (CR-087 · schema.md §2.14).
 *
 * Why a separate doc instead of a field on the donation: shelter DBs are isolated
 * (`shelter_<code>` + `isInCallerScope`), so a `redirect_to_shelter_code` on the
 * origin's donation is invisible to the destination's staff. This doc is written
 * INTO the destination DB, which is the only place they can see it.
 *
 * It is a **snapshot**, not a mirror — it never syncs back to the origin donation,
 * and it carries only the donor fields the destination needs to make contact
 * (data minimization: no `phone_hash`, `line_id`, or `email`).
 */
export interface DonationRedirect extends BaseDoc {
	type: 'donation_redirect';
	origin_shelter_code: string;
	origin_donation_id: string;
	booking_ref: string | null;
	donor: { name: string; phone: string | null };
	items: Array<{
		item_id?: string;
		free_text?: string;
		qty: string;
		unit: string;
		category?: string;
		condition?: string;
		note?: string;
	}>;
	note: string | null;
	/**
	 * Always starts at `pending_review`: the destination decides for itself and
	 * does NOT inherit where the origin's review had got to (CR-087).
	 */
	status: 'pending_review';
	created_at: Timestamp;
}

const redirectItemSchema = z.object({
	item_id: z.string().optional(),
	free_text: z.string().optional(),
	qty: z.string().min(1),
	unit: z.string().min(1),
	category: z.string().optional(),
	condition: z.string().optional(),
	note: z.string().optional()
});

/** Body of `POST /api/back-office/donations/[query]/redirect`. */
export const donationRedirectInputSchema = z.object({
	target_shelter_code: z.string().trim().min(1),
	note: z.string().trim().max(500).optional()
});
export type DonationRedirectInput = z.infer<typeof donationRedirectInputSchema>;

export const donationRedirectDocSchema = z.object({
	_id: z.string().regex(/^donation_redirect:/),
	type: z.literal('donation_redirect'),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	origin_shelter_code: z.string().min(1),
	origin_donation_id: z.string().regex(/^donation:/),
	booking_ref: z.string().nullable(),
	donor: z.object({ name: z.string(), phone: z.string().nullable() }),
	items: z.array(redirectItemSchema),
	note: z.string().nullable(),
	status: z.literal('pending_review'),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
});

export function isDonationRedirect(doc: unknown): doc is DonationRedirect {
	return donationRedirectDocSchema.safeParse(doc).success;
}

/**
 * Mint the destination's ticket. `ctx.shelterCode` must be the **destination**
 * shelter — the doc lives in that shelter's DB, so the envelope has to agree with
 * it or the destination's `_design/access` guard would reject the row.
 */
export function createDonationRedirect(
	input: {
		origin_shelter_code: string;
		origin_donation_id: string;
		booking_ref?: string | null;
		donor: { name: string; phone?: string | null };
		items: DonationRedirect['items'];
		note?: string | null;
	},
	ctx: AuthorContext
): DonationRedirect {
	return makeDoc(
		'donation_redirect',
		1,
		{
			origin_shelter_code: input.origin_shelter_code,
			origin_donation_id: input.origin_donation_id,
			booking_ref: input.booking_ref ?? null,
			donor: { name: input.donor.name, phone: input.donor.phone ?? null },
			items: input.items,
			note: input.note?.trim() ? input.note.trim() : null,
			status: 'pending_review' as const
		},
		ctx
	);
}
