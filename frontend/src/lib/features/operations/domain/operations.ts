import { z } from 'zod';
import { type AuthorContext, type BaseDoc, type Timestamp, makeDoc, now } from '$lib/db/model';
import {
	addQty,
	persistQty,
	qtyAbs,
	qtyGte,
	qtyNeg,
	qtyStrSignedNonZeroSchema,
	qtyStrCoercePositiveSchema,
	qtyStrCoerceSignedNonZeroSchema,
	subQty
} from '$lib/utils/qty';

/**
 * Operations domain — stock, donations, transfers (R2–R3).
 *
 * NOTE (CR-034 scope): `DonationLogistics`, `DonationSlot`, and donation
 * `schema_v` 2 fields pre-date CR-034 — aligned under CR-005 §F, not part of
 * the donation_campaign cutoff change set.
 *
 * Two invariants from the spec carry real weight here:
 *
 *  1. `stock_ledger` is append-only and event-sourced: the balance of an item
 *     is the SUM of its signed deltas, never a stored field (data-model.md §4,
 *     view `stock_balance`).
 *
 *  2. A declared donation does NOT become stock automatically. When goods
 *     physically arrive, staff count them and key the receipt by hand
 *     (`keyDonationReceipt`), which is what mints the `stock_ledger` entries.
 *     `donation.items` is a planning signal only
 *     (docs/data/data-model.md §4).
 */

// ---------------------------------------------------------------- enums

export const ledgerReasonSchema = z.enum([
	'receive',
	'distribute',
	'requisition',
	'adjust',
	'transfer_out',
	'transfer_in',
	'donation',
	'purchase'
]);
export type LedgerReason = z.infer<typeof ledgerReasonSchema>;

export const donationStatusSchema = z.enum(['declared', 'received', 'expired', 'cancelled']);
export type DonationStatus = z.infer<typeof donationStatusSchema>;

export const transferStatusSchema = z.enum(['requested', 'shipped', 'received', 'cancelled']);
export type TransferStatus = z.infer<typeof transferStatusSchema>;

export const donationChannelSchema = z.enum(['public', 'walk_in']);
export type DonationChannel = z.infer<typeof donationChannelSchema>;

// ---------------------------------------------------------------- documents

export interface StockLot {
	expiry?: Timestamp;
	note?: string;
}

export interface StockLedger extends BaseDoc {
	type: 'stock_ledger';
	item_id: string;
	qty: string; // qty_str signed: + in, − out; never 0
	unit: string;
	reason: LedgerReason;
	ref_id: string | null; // originating doc (donation/transfer/requisition)
	lot?: StockLot;
	occurred_at: Timestamp;
}

export interface DonationItem {
	item_id?: string;
	free_text?: string;
	qty: string; // qty_str
	unit: string;
	category?: string;
	condition?: string;
	note?: string;
}

export interface Donor {
	name: string;
	phone: string | null;
	phone_hash: string;
	line_id?: string | null;
	email?: string | null;
}

//  public logistics & queue booking
export interface DonationLogistics {
	delivery_method: 'self_dropoff' | 'parcel' | 'shelter_pickup';
	vehicle?: 'motorcycle' | 'car' | 'pickup' | 'truck';
	slot?: {
		date: string;
		from: string;
		to: string;
	} | null;
	eta?: Timestamp | null;
	courier_tracking_no?: string | null;
}

export interface Donation extends BaseDoc {
	type: 'donation';
	channel: DonationChannel;
	donor: Donor;
	kind: 'items' | 'money';
	items?: DonationItem[];
	amount_thb?: number;
	campaign_id: string | null;
	status: DonationStatus;
	tracking_token_hash: string;
	declared_at: Timestamp;
	received_at: Timestamp | null;
	expires_at: Timestamp;
	booking_ref?: string;
	logistics?: DonationLogistics;
}

export interface DonationSlot extends BaseDoc {
	type: 'donation_slot';
	date: string; // YYYY-MM-DD
	from: string; // HH:mm
	to: string; // HH:mm
	capacity: number;
	status: 'open' | 'closed';
	note?: string;
}

export interface CampaignNeed {
	item_id: string;
	qty_target: string; // qty_str
	unit: string;
	status?: 'open' | 'closed';
}

export interface DonationCampaign extends BaseDoc {
	type: 'donation_campaign';
	title: string;
	needs: CampaignNeed[];
	status: 'open' | 'closed';
	opens_at?: Timestamp;
	closes_at?: Timestamp | null;
	notes?: string;
	visible_on_home?: boolean;
}

export type OperationsDoc = StockLedger | Donation | DonationCampaign | Purchase;

// ---------------------------------------------------------------- stock_ledger

export const stockLedgerInputSchema = z.object({
	item_id: z.string().min(1),
	qty: qtyStrCoerceSignedNonZeroSchema,
	unit: z.string().trim().min(1),
	reason: ledgerReasonSchema,
	ref_id: z.string().nullable().default(null),
	lot: z.object({ expiry: z.string().optional(), note: z.string().trim().optional() }).optional(),
	occurred_at: z.string().optional()
});
export type StockLedgerInput = z.input<typeof stockLedgerInputSchema>;

/** Full persisted stock_ledger contract used before signed-sum calculations. */
export const stockLedgerDocSchema = z
	.object({
		_id: z.string().regex(/^stock_ledger:/),
		_rev: z.string().optional(),
		type: z.literal('stock_ledger'),
		schema_v: z.union([z.literal(2), z.literal(3)]),
		shelter_code: z.string().min(1),
		created_at: z.string().datetime(),
		updated_at: z.string().datetime(),
		created_by: z.string().min(1),
		item_id: z.string().min(1),
		qty: qtyStrSignedNonZeroSchema,
		unit: z.string().trim().min(1),
		reason: ledgerReasonSchema,
		ref_id: z.string().nullable(),
		lot: z.object({ expiry: z.string().optional(), note: z.string().trim().optional() }).optional(),
		occurred_at: z.string().datetime()
	})
	.passthrough()
	.superRefine((doc, ctx) => {
		if (doc.schema_v === 2 && doc.reason === 'purchase') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['reason'],
				message: 'purchase requires stock_ledger schema_v 3'
			});
		}
	});

/** Parse one persisted ledger entry and fail closed before it contributes to a balance. */
export function parseStockLedger(input: unknown): StockLedger {
	return stockLedgerDocSchema.parse(input) as StockLedger;
}

export function createStockLedger(input: StockLedgerInput, ctx: AuthorContext): StockLedger {
	const d = stockLedgerInputSchema.parse(input);
	return makeDoc(
		'stock_ledger',
		3,
		{
			item_id: d.item_id,
			qty: persistQty(d.qty),
			unit: d.unit,
			reason: d.reason,
			ref_id: d.ref_id,
			...(d.lot ? { lot: d.lot } : {}),
			occurred_at: d.occurred_at ?? now()
		},
		ctx
	);
}

export const receiveSourceSchema = z.enum([
	'donation', // บริจาค (ประชาชน / เอกชน / มูลนิธิ)
	'transfer_in', // โอนมาจากศูนย์อื่น
	'manual' // กรอกเอง / ปรับปรุงสต๊อก
]);
export type ReceiveSource = z.infer<typeof receiveSourceSchema>;

export const receiveInputSchema = z.object({
	item_id: z.string().min(1),
	qty: qtyStrCoercePositiveSchema,
	unit: z.string().trim().min(1),
	source: receiveSourceSchema,
	ref_id: z.string().nullable().default(null),
	lot: z
		.object({
			expiry: z.string().optional(),
			note: z.string().trim().optional()
		})
		.optional(),
	occurred_at: z.string().optional()
});
export type ReceiveInput = z.input<typeof receiveInputSchema>;

/**
 * Converts a ReceiveInput into a StockLedger entry.
 *
 * INVARIANT: The caller is responsible for enforcing that `lot.expiry` is provided
 * when the corresponding SupplyItem is marked as `perishable`. This domain layer
 * cannot validate it because it does not load the catalog item synchronously.
 * See UI enforcement in receive-stock-form.svelte.
 * NOTE: CouchDB `validate_doc_update` should eventually enforce this server-side.
 */
export function createReceiveEntry(input: ReceiveInput, ctx: AuthorContext): StockLedger {
	const d = receiveInputSchema.parse(input);
	let reason: LedgerReason;
	switch (d.source) {
		case 'donation':
			reason = 'donation';
			break;
		case 'transfer_in':
			// TODO(T-13): source is defined here for schema completeness but is not yet wired
			// through a real transfer-in flow. Inter-shelter transfers land via T-13 confirm step.
			reason = 'transfer_in';
			break;
		case 'manual':
			reason = 'adjust';
			break;
		default: {
			const _exhaustiveCheck: never = d.source;
			throw new Error(`Unhandled receive source: ${_exhaustiveCheck}`);
		}
	}
	return createStockLedger(
		{
			item_id: d.item_id,
			qty: d.qty,
			unit: d.unit,
			reason,
			ref_id: d.ref_id,
			lot: d.lot,
			occurred_at: d.occurred_at
		},
		ctx
	);
}

export const distributeInputSchema = z.object({
	item_id: z.string().min(1),
	qty: qtyStrCoercePositiveSchema,
	unit: z.string().trim().min(1),
	ref_id: z.string().nullable().default(null),
	note: z.string().trim().optional(), // Used to store destination in lot.note
	occurred_at: z.string().optional()
});
export type DistributeInput = z.input<typeof distributeInputSchema>;

export function createDistributeEntry(input: DistributeInput, ctx: AuthorContext): StockLedger {
	const d = distributeInputSchema.parse(input);
	return createStockLedger(
		{
			item_id: d.item_id,
			qty: qtyNeg(qtyAbs(d.qty)), // force outbound negative delta
			unit: d.unit,
			reason: 'distribute',
			ref_id: d.ref_id,
			...(d.note ? { lot: { note: d.note } } : {}),
			occurred_at: d.occurred_at
		},
		ctx
	);
}

export const adjustInputSchema = z.object({
	item_id: z.string().min(1),
	qty: qtyStrCoerceSignedNonZeroSchema,
	unit: z.string().trim().min(1),
	ref_id: z.string().nullable().default(null), // Always null for manual stock adjustments (no originating transfer/donation doc)
	lot: z
		.object({
			expiry: z.string().optional(),
			note: z.string().trim().optional()
		})
		.optional(),
	occurred_at: z.string().optional()
});
export type AdjustInput = z.input<typeof adjustInputSchema>;

export function createAdjustEntry(input: AdjustInput, ctx: AuthorContext): StockLedger {
	const d = adjustInputSchema.parse(input);
	return createStockLedger(
		{
			item_id: d.item_id,
			qty: d.qty, // Keep signed quantity as is (+ for add, - for write-off)
			unit: d.unit,
			reason: 'adjust',
			ref_id: d.ref_id,
			lot: d.lot,
			occurred_at: d.occurred_at
		},
		ctx
	);
}

/** Sum signed deltas per item — the `stock_balance` read model, computed client-side. */
export function stockBalance(ledger: StockLedger[]): Map<string, string> {
	const balance = new Map<string, string>();
	for (const entry of ledger) {
		balance.set(entry.item_id, addQty(balance.get(entry.item_id) ?? '0', entry.qty));
	}
	return balance;
}

// ---------------------------------------------------------------- donation

const donationItemSchema = z
	.object({
		item_id: z.string().optional(),
		free_text: z.string().trim().optional(),
		qty: qtyStrCoercePositiveSchema,
		unit: z.string().trim().min(1)
	})
	.refine((i) => Boolean(i.item_id) !== Boolean(i.free_text), {
		message: 'Provide exactly one of item_id or free_text'
	});

/** Walk-in donation captured at the shelter. Public donations arrive via sync already shaped. */
export const walkInDonationInputSchema = z
	.object({
		donor: z.object({
			name: z.string().trim().min(1),
			phone: z
				.string()
				.trim()
				.regex(/^[0-9]+$/)
				.nullable(),
			phone_hash: z.string().min(1),
			tax_receipt: z.boolean().optional(),
			tax_id: z.string().optional()
		}),
		kind: z.enum(['items', 'money']),
		items: z.array(donationItemSchema).optional(),
		amount_thb: z.coerce.number().positive().optional(),
		campaign_id: z.string().nullable().default(null),
		tracking_token_hash: z.string().min(1),
		reservation_ttl_hours: z.coerce.number().int().positive().default(72)
	})
	.refine((d) => (d.kind === 'items' ? !!d.items?.length : d.amount_thb != null), {
		message: 'items donations need items; money donations need amount_thb'
	});
export type WalkInDonationInput = z.input<typeof walkInDonationInputSchema>;

export function createWalkInDonation(input: WalkInDonationInput, ctx: AuthorContext): Donation {
	const d = walkInDonationInputSchema.parse(input);
	const declaredAt = now();
	const expiresAt = new Date(
		Date.parse(declaredAt) + d.reservation_ttl_hours * 3600_000
	).toISOString();
	return makeDoc(
		'donation',
		3,
		{
			channel: 'walk_in' as const,
			donor: d.donor,
			kind: d.kind,
			...(d.items ? { items: d.items.map((i) => ({ ...i, qty: persistQty(i.qty) })) } : {}),
			...(d.amount_thb != null ? { amount_thb: d.amount_thb } : {}),
			campaign_id: d.campaign_id,
			status: 'declared' as const,
			tracking_token_hash: d.tracking_token_hash,
			declared_at: declaredAt,
			received_at: null,
			expires_at: expiresAt
		},
		ctx
	);
}

/** Forward-only transitions for a donation (schema.md §2.3). */
const DONATION_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
	declared: ['received', 'expired', 'cancelled'],
	received: [],
	expired: [],
	cancelled: []
};

export function canTransitionDonation(from: DonationStatus, to: DonationStatus): boolean {
	return DONATION_TRANSITIONS[from].includes(to);
}

/**
 * Mark a declared donation received. This ONLY moves the lifecycle — it does
 * not touch stock. Keying the physical count is a separate, deliberate step
 * (`keyDonationReceipt`).
 */
export function receiveDonation(donation: Donation): Donation {
	if (!canTransitionDonation(donation.status, 'received')) {
		throw new Error(`Cannot receive a donation in status "${donation.status}"`);
	}
	return { ...donation, status: 'received', received_at: now(), updated_at: now() };
}

/** Expire a declared donation past its TTL (run by a job — schema.md §2.3). */
export function expireDonation(donation: Donation): Donation {
	if (!canTransitionDonation(donation.status, 'expired')) {
		throw new Error(`Cannot expire a donation in status "${donation.status}"`);
	}
	return { ...donation, status: 'expired', updated_at: now() };
}

/** A line staff actually counted when the goods arrived — may differ from what was declared. */
export interface CountedItem {
	item_id: string;
	qty: string; // qty_str positive, as physically counted
	unit: string;
	lot?: StockLot;
}

/**
 * Turn a hand counted donation into stock. This is the ONLY path from a
 * donation to `stock_ledger`; there is no automatic conversion of the declared
 * items. Each counted line becomes one positive `receive` ledger entry
 * referencing the donation.
 */
export function keyDonationReceipt(
	donation: Donation,
	counted: CountedItem[],
	ctx: AuthorContext
): StockLedger[] {
	return counted.map((c) =>
		createStockLedger(
			{
				item_id: c.item_id,
				qty: qtyAbs(c.qty),
				unit: c.unit,
				reason: 'donation',
				ref_id: donation._id,
				...(c.lot ? { lot: c.lot } : {})
			},
			ctx
		)
	);
}

// ---------------------------------------------------------------- purchase

export interface PurchaseItem {
	item_id: string;
	qty: string; // qty_str — planning signal only; the real delta lives in stock_ledger
	unit: string;
}

/**
 * A procurement record — schema.md §2.16. Like a donation it does NOT become
 * stock on its own: it carries the vendor/PO metadata a ledger row has no room
 * for, and is created in its own step. Staff key the physical count separately
 * via `keyPurchaseReceipt`. There is no `status` (CR-032 dropped the state
 * machine) — "received?" is inferred from ledger rows whose `ref_id` points
 * here. `items` is a planning signal only.
 */
export interface Purchase extends BaseDoc {
	type: 'purchase';
	vendor: string;
	po_ref?: string;
	items: PurchaseItem[];
	occurred_at: Timestamp;
	note?: string;
}

export const purchaseInputSchema = z.object({
	vendor: z.string().trim().min(1),
	po_ref: z.string().trim().optional(),
	items: z
		.array(
			z.object({
				item_id: z.string().min(1),
				qty: qtyStrCoercePositiveSchema,
				unit: z.string().trim().min(1)
			})
		)
		.min(1, 'A purchase needs at least one item'),
	occurred_at: z.string().optional(),
	note: z.string().trim().optional()
});
export type PurchaseInput = z.input<typeof purchaseInputSchema>;

export function createPurchase(input: PurchaseInput, ctx: AuthorContext): Purchase {
	const d = purchaseInputSchema.parse(input);
	return makeDoc(
		'purchase',
		1,
		{
			vendor: d.vendor,
			...(d.po_ref ? { po_ref: d.po_ref } : {}),
			items: d.items.map((i) => ({ ...i, qty: persistQty(i.qty) })),
			occurred_at: d.occurred_at ?? now(),
			...(d.note ? { note: d.note } : {})
		},
		ctx
	);
}

/**
 * Validator for the lines staff key against a purchase — the form-side mirror of
 * the `CountedItem[]` that `keyPurchaseReceipt` consumes. At least one line is
 * required, matching the repository's refusal to write an empty receipt.
 *
 * `lot.expiry` is deliberately optional here: whether an item is perishable
 * lives in the supply catalog, which the domain layer cannot see, so that check
 * stays with the caller (same split as `receiveInputSchema`).
 */
export const purchaseReceiptInputSchema = z.object({
	counted: z
		.array(
			z.object({
				item_id: z.string().min(1),
				qty: qtyStrCoercePositiveSchema,
				unit: z.string().trim().min(1),
				lot: z
					.object({
						expiry: z.string().optional(),
						note: z.string().trim().optional()
					})
					.optional()
			})
		)
		.min(1, 'A receipt needs at least one counted line')
});
export type PurchaseReceiptInput = z.input<typeof purchaseReceiptInputSchema>;

/**
 * Turn a hand counted purchase into stock. This is the ONLY path from a purchase
 * to `stock_ledger`, mirroring `keyDonationReceipt`. Each counted line becomes
 * one positive `purchase` ledger entry referencing the purchase doc — which was
 * already committed in an earlier step, so this is a plain append with no
 * cross-doc write to keep consistent.
 */
export function keyPurchaseReceipt(
	purchase: Purchase,
	counted: CountedItem[],
	ctx: AuthorContext
): StockLedger[] {
	return counted.map((c) =>
		createStockLedger(
			{
				item_id: c.item_id,
				qty: qtyAbs(c.qty),
				unit: c.unit,
				reason: 'purchase',
				ref_id: purchase._id,
				...(c.lot ? { lot: c.lot } : {})
			},
			ctx
		)
	);
}

/** How much of a purchase has physically arrived — always derived, never stored. */
export type PurchaseReceiptStatus = 'not_received' | 'partial' | 'received';

/**
 * Derive a purchase's receipt status from the ledger (schema.md §2.16). The doc
 * deliberately has no `status` field: the ledger is the only truth, so the badge
 * can never drift from the balance it is shown next to.
 *
 * Receiving more than ordered still counts as `received` — goods arriving over
 * the ordered amount is normal, and the overage stays visible by comparing the
 * numbers. Lines keyed for items absent from `items` don't move the status.
 */
export function purchaseReceiptStatus(
	purchase: Purchase,
	stockLedgers: StockLedger[]
): PurchaseReceiptStatus {
	const receivedByItem = new Map<string, string>();
	for (const entry of stockLedgers) {
		if (entry.reason !== 'purchase' || entry.ref_id !== purchase._id) continue;
		receivedByItem.set(
			entry.item_id,
			addQty(receivedByItem.get(entry.item_id) ?? '0', qtyAbs(entry.qty))
		);
	}

	if (receivedByItem.size === 0) return 'not_received';
	const complete = purchase.items.every((item) =>
		qtyGte(receivedByItem.get(item.item_id) ?? '0', item.qty)
	);
	return complete ? 'received' : 'partial';
}

/**
 * A purchase may only be corrected while nothing has been keyed against it:
 * `items` is what the receipt status and the ordered-vs-actual audit compare
 * against, so editing it mid-receipt would move the goalposts (CR-032).
 */
export function canEditPurchase(purchase: Purchase, stockLedgers: StockLedger[]): boolean {
	return purchaseReceiptStatus(purchase, stockLedgers) === 'not_received';
}

// ---------------------------------------------------------------- campaign

export const campaignInputSchema = z.object({
	title: z.string().trim().min(1),
	needs: z
		.array(
			z.object({
				item_id: z.string().min(1),
				qty_target: qtyStrCoercePositiveSchema,
				unit: z.string().trim().min(1),
				status: z.enum(['open', 'closed']).optional().default('open')
			})
		)
		.min(1, 'A campaign needs at least one item'),
	opens_at: z.string().optional(),
	closes_at: z.string().nullable().optional(),
	notes: z.string().trim().optional(),
	visible_on_home: z.boolean().optional().default(true)
});
export type CampaignInput = z.input<typeof campaignInputSchema>;

export function createCampaign(input: CampaignInput, ctx: AuthorContext): DonationCampaign {
	const d = campaignInputSchema.parse(input);
	return makeDoc(
		'donation_campaign',
		3,
		{
			title: d.title,
			needs: d.needs.map((n) => ({ ...n, qty_target: persistQty(n.qty_target) })),
			status: 'open' as const,
			visible_on_home: d.visible_on_home,
			...(d.opens_at ? { opens_at: d.opens_at } : {}),
			...(d.closes_at !== undefined ? { closes_at: d.closes_at } : {}),
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx
	);
}

/**
 * Calculates the reserved donation amount that has been quota-cleared.
 * This reserved amount includes:
 * - Donation documents with a 'declared' status.
 * - Donation documents with a 'received' status that have not yet been added to the inventory stock (no referenced ledger entry).
 */
export function calculateReserved(
	donations: Donation[],
	stockLedgers: StockLedger[],
	campaignId?: string
): Map<string, string> {
	const keyedDonationIds = new Set<string>();
	for (const ledger of stockLedgers) {
		if (ledger.reason === 'donation' && ledger.ref_id) {
			keyedDonationIds.add(ledger.ref_id);
		}
	}

	const reserved = new Map<string, string>();
	for (const don of donations) {
		if (campaignId && don.campaign_id !== campaignId) continue;
		if (don.status === 'expired' || don.status === 'cancelled') continue;
		const isUnkeyedReceived = don.status === 'received' && !keyedDonationIds.has(don._id);
		if (don.status !== 'declared' && !isUnkeyedReceived) continue;
		for (const item of don.items ?? []) {
			if (!item.item_id) continue;
			reserved.set(item.item_id, addQty(reserved.get(item.item_id) ?? '0', item.qty));
		}
	}
	return reserved;
}

export interface NeedAvailability {
	item_id: string;
	qty_target: string;
	qty_on_hand: string;
	qty_reserved: string;
	qty_remaining: string;
	is_cut_off: boolean;
	status: 'open' | 'closed';
	unit: string;
}

export function deriveNeedAvailability(
	campaign: DonationCampaign,
	donations: Donation[],
	stockLedgers: StockLedger[]
): NeedAvailability[] {
	const onHand = stockBalance(stockLedgers);
	const reserved = calculateReserved(donations, stockLedgers, campaign._id);

	return campaign.needs.map((need) => {
		const currentOnHand = onHand.get(need.item_id) ?? '0';
		const currentReserved = reserved.get(need.item_id) ?? '0';
		const covered = addQty(currentOnHand, currentReserved);
		const rem = subQty(need.qty_target, covered);
		const remaining = qtyGte(rem, 0) ? rem : '0';
		const isCutOff = isNeedCutOff(
			need.qty_target,
			currentOnHand,
			currentReserved,
			need.status,
			campaign.status
		);

		return {
			item_id: need.item_id,
			qty_target: need.qty_target,
			qty_on_hand: currentOnHand,
			qty_reserved: currentReserved,
			qty_remaining: remaining,
			is_cut_off: isCutOff,
			status: need.status ?? 'open',
			unit: need.unit
		};
	});
}

/**
 * Remaining open need per item: target minus on-hand stock, active reservations,
 * and donations (declared+received, not expired/cancelled) already cover.
 * Drives `GET /public/v1/needs` (data-model.md §4, view `needs_open`).
 *
 * **Migration (CR-034):** callers must pass `stockLedgers` so cut-off reflects
 * warehouse on-hand + reserved donations. Omit or pass `[]` only when stock
 * context is unavailable (legacy two-arg call sites).
 */
export function openNeeds(
	campaign: DonationCampaign,
	donations: Donation[],
	stockLedgers: StockLedger[] = []
): CampaignNeed[] {
	const availabilities = deriveNeedAvailability(campaign, donations, stockLedgers);
	return availabilities
		.filter((avail) => !avail.is_cut_off)
		.map((avail) => ({
			item_id: avail.item_id,
			qty_target: avail.qty_remaining,
			unit: avail.unit,
			status: avail.status
		}));
}

// ---------------------------------------------------------------- type guards

export const isStockLedger = (d: unknown): d is StockLedger =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'stock_ledger';
export const isDonation = (d: unknown): d is Donation =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation';
export const isDonationCampaign = (d: unknown): d is DonationCampaign =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_campaign';
export const isPurchase = (d: unknown): d is Purchase =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'purchase';

// ---------------------------------------------------------------- special request form schema
export const specialRequestSchema = z.object({
	name: z.string().trim().min(1, 'กรุณาระบุชื่อพัสดุ / ประกาศ'),
	target: qtyStrCoercePositiveSchema,
	location: z.string().trim().min(1, 'กรุณาระบุคลังเป้าหมาย')
});
export type SpecialRequestInput = z.infer<typeof specialRequestSchema>;

/**
 * Determines the donation cut-off status (T-22 Cut-off Rule).
 * Automatically closes when: On-hand inventory (onHand) + Reserved amount (reserved) >= Target (target)
 * Or when the campaign is manually closed.
 */
export function isNeedCutOff(
	qtyTarget: string | number,
	onHandStock: string | number,
	reservedQty: string | number,
	needStatus?: 'open' | 'closed',
	campaignStatus?: 'open' | 'closed'
): boolean {
	if (campaignStatus === 'closed' || needStatus === 'closed') return true;
	return qtyGte(addQty(onHandStock, reservedQty), qtyTarget);
}

// public donation time-slot booking (R2.3)
// The slot is “used” when a donation is received into it.
export const isDonationSlot = (d: unknown): d is DonationSlot =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_slot';

/**
 * Maps a Thai item name heuristic to a slugged itemId.
 */
export function mapNeedItemHeuristic(name: string): string {
	const lowerName = name.toLowerCase();
	if (lowerName.includes('ข้าว')) return 'item:rice';
	if (lowerName.includes('น้ำ')) return 'item:water';
	if (lowerName.includes('พารา') || lowerName.includes('ยา')) return 'item:paracetamol';
	if (lowerName.includes('สบู่')) return 'item:soap';
	if (lowerName.includes('ห่ม')) return 'item:blanket';
	if (lowerName.includes('ไข่')) return 'item:egg';

	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `item:${slug || 'custom'}`;
}
