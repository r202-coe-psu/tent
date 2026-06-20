import { z } from 'zod';
import { type AuthorContext, type BaseDoc, type Timestamp, makeDoc, now } from '$lib/db/model';

/**
 * Operations domain — stock, donations, transfers (R2–R3).
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
 *     (docs/data/couchdb-mongodb-sync.md §4.2).
 */

// ---------------------------------------------------------------- enums

export const ledgerReasonSchema = z.enum([
	'receive',
	'distribute',
	'requisition',
	'adjust',
	'transfer_out',
	'transfer_in',
	'donation'
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
	qty: number; // signed: + in, − out; never 0
	unit: string;
	reason: LedgerReason;
	ref_id: string | null; // originating doc (donation/transfer/requisition)
	lot?: StockLot;
	occurred_at: Timestamp;
}

export interface DonationItem {
	item_id?: string;
	free_text?: string;
	qty: number;
	unit: string;
}

export interface Donor {
	name: string;
	phone: string | null;
	phone_hash: string;
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
}

export interface CampaignNeed {
	item_id: string;
	qty_target: number;
	unit: string;
}

export interface DonationCampaign extends BaseDoc {
	type: 'donation_campaign';
	title: string;
	needs: CampaignNeed[];
	status: 'open' | 'closed';
	opens_at?: Timestamp;
	closes_at?: Timestamp | null;
	notes?: string;
}

export type OperationsDoc = StockLedger | Donation | DonationCampaign;

// ---------------------------------------------------------------- stock_ledger

export const stockLedgerInputSchema = z.object({
	item_id: z.string().min(1),
	qty: z.coerce.number().refine((n) => n !== 0, 'Quantity cannot be zero'),
	unit: z.string().trim().min(1),
	reason: ledgerReasonSchema,
	ref_id: z.string().nullable().default(null),
	lot: z.object({ expiry: z.string().optional(), note: z.string().trim().optional() }).optional(),
	occurred_at: z.string().optional()
});
export type StockLedgerInput = z.input<typeof stockLedgerInputSchema>;

export function createStockLedger(input: StockLedgerInput, ctx: AuthorContext): StockLedger {
	const d = stockLedgerInputSchema.parse(input);
	return makeDoc(
		'stock_ledger',
		1,
		{
			item_id: d.item_id,
			qty: d.qty,
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
	'purchase', // จัดซื้อ / หน่วยงานรัฐ
	'transfer_in', // โอนมาจากศูนย์อื่น
	'manual' // กรอกเอง / ปรับปรุงสต๊อก
]);
export type ReceiveSource = z.infer<typeof receiveSourceSchema>;

export const receiveInputSchema = z.object({
	item_id: z.string().min(1),
	qty: z.coerce.number().positive('Quantity must be > 0'),
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

export function createReceiveEntry(input: ReceiveInput, ctx: AuthorContext): StockLedger {
	const d = receiveInputSchema.parse(input);
	let reason: LedgerReason;
	switch (d.source) {
		case 'donation':
			reason = 'donation';
			break;
		case 'purchase':
			reason = 'receive';
			break;
		case 'transfer_in':
			reason = 'transfer_in';
			break;
		case 'manual':
			reason = 'adjust';
			break;
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

/** Sum signed deltas per item — the `stock_balance` read model, computed client-side. */
export function stockBalance(ledger: StockLedger[]): Map<string, number> {
	const balance = new Map<string, number>();
	for (const entry of ledger) {
		balance.set(entry.item_id, (balance.get(entry.item_id) ?? 0) + entry.qty);
	}
	return balance;
}

// ---------------------------------------------------------------- donation

const donationItemSchema = z
	.object({
		item_id: z.string().optional(),
		free_text: z.string().trim().optional(),
		qty: z.coerce.number().positive(),
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
			phone_hash: z.string().min(1)
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
		1,
		{
			channel: 'walk_in' as const,
			donor: d.donor,
			kind: d.kind,
			...(d.items ? { items: d.items } : {}),
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
	qty: number; // positive, as physically counted
	unit: string;
	lot?: StockLot;
}

/**
 * Turn a hand counted donation into stock. This is the ONLY path from a
 * donation to `stock_ledger`; there is no automatic conversion of the declared
 * items (docs/data/couchdb-mongodb-sync.md §4.2). Each counted line becomes one
 * positive `receive` ledger entry referencing the donation.
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
				qty: Math.abs(c.qty),
				unit: c.unit,
				reason: 'donation',
				ref_id: donation._id,
				...(c.lot ? { lot: c.lot } : {})
			},
			ctx
		)
	);
}

// ---------------------------------------------------------------- campaign

export const campaignInputSchema = z.object({
	title: z.string().trim().min(1),
	needs: z
		.array(
			z.object({
				item_id: z.string().min(1),
				qty_target: z.coerce.number().positive(),
				unit: z.string().trim().min(1)
			})
		)
		.min(1, 'A campaign needs at least one item'),
	opens_at: z.string().optional(),
	closes_at: z.string().nullable().optional(),
	notes: z.string().trim().optional()
});
export type CampaignInput = z.input<typeof campaignInputSchema>;

export function createCampaign(input: CampaignInput, ctx: AuthorContext): DonationCampaign {
	const d = campaignInputSchema.parse(input);
	return makeDoc(
		'donation_campaign',
		1,
		{
			title: d.title,
			needs: d.needs,
			status: 'open' as const,
			...(d.opens_at ? { opens_at: d.opens_at } : {}),
			...(d.closes_at !== undefined ? { closes_at: d.closes_at } : {}),
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx
	);
}

/**
 * Remaining open need per item: target minus what donations (declared+received,
 * not expired/cancelled) already cover. Drives `GET /public/v1/needs`
 * (data-model.md §4, view `needs_open`).
 */
export function openNeeds(campaign: DonationCampaign, donations: Donation[]): CampaignNeed[] {
	const covered = new Map<string, number>();
	for (const don of donations) {
		if (don.campaign_id !== campaign._id) continue;
		if (don.status === 'expired' || don.status === 'cancelled') continue;
		for (const item of don.items ?? []) {
			if (!item.item_id) continue;
			covered.set(item.item_id, (covered.get(item.item_id) ?? 0) + item.qty);
		}
	}
	return campaign.needs
		.map((need) => ({
			...need,
			qty_target: need.qty_target - (covered.get(need.item_id) ?? 0)
		}))
		.filter((need) => need.qty_target > 0);
}

// ---------------------------------------------------------------- type guards

export const isStockLedger = (d: unknown): d is StockLedger =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'stock_ledger';
export const isDonation = (d: unknown): d is Donation =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation';
export const isDonationCampaign = (d: unknown): d is DonationCampaign =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_campaign';
