import { z } from 'zod';
import { type AuthorContext, type BaseDoc, type Timestamp, makeDoc, now } from '$lib/db/model';
import {
	addQty,
	persistQty,
	qtyAbs,
	qtyGt,
	qtyGte,
	qtyNeg,
	qtyStrSignedNonZeroSchema,
	qtyStrCoercePositiveSchema,
	qtyStrCoerceSignedNonZeroSchema,
	qtyStrCoerceNonNegativeSchema,
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

/**
 * `pending_review` / `verifying` / `rejected` land here per the CR-052-approved
 * enum (schema.md §2.3, `donation.status`) — the code was behind the doc, not the
 * other way around (T-16).
 */
export const donationStatusSchema = z.enum([
	'declared',
	'pending_review',
	'verifying',
	'received',
	'redirected',
	'rejected',
	'expired',
	'cancelled'
]);
export type DonationStatus = z.infer<typeof donationStatusSchema>;

/**
 * Statuses where the goods have not reached the shelf yet but the booking still
 * holds its share of a campaign's target (schema.md §2.3 / §2.13).
 *
 * Since CR-052 a public booking opens at `pending_review`, walks through
 * `verifying`, and only becomes `received` once staff key the count. Every place
 * that asks "how much is still owed to us?" — reserved totals, cut-off, slot
 * capacity — has to count all three, or the moment the initial status moved off
 * `declared` the quota would read as free and the board would reopen a full need.
 */
export const DONATION_OUTSTANDING_STATUSES: readonly DonationStatus[] = [
	'declared',
	'pending_review',
	'verifying'
];

export function isDonationOutstanding(status: DonationStatus): boolean {
	return DONATION_OUTSTANDING_STATUSES.includes(status);
}

export const transferStatusSchema = z.enum(['requested', 'shipped', 'received', 'cancelled']);
export type TransferStatus = z.infer<typeof transferStatusSchema>;

export const donationChannelSchema = z.enum(['public', 'walk_in']);
export type DonationChannel = z.infer<typeof donationChannelSchema>;

export interface TransferTimelineEvent {
	at: Timestamp;
	by: string; // _users name
}

// ---------------------------------------------------------------- documents

export interface StockLot {
	expiry?: Timestamp;
	note?: string;
	/**
	 * Human-readable lot label `L-YYMMDD-XXX` minted at receive time (CR-088).
	 * A LABEL only — no business rule keys off it, so a duplicate would be a
	 * cosmetic clash, never a wrong balance. Balances always come from `qty`.
	 */
	lot_no?: string;
	/** Where the goods were physically put away. Free text — no zone master data yet (CR-088). */
	storage_zone?: string;
}

/** `L-YYMMDD-XXX` — `YYMMDD` = receive date, `XXX` = 3-digit per-day per-shelter sequence. */
export const LOT_NO_PATTERN = /^L-\d{6}-\d{3}$/;

/**
 * Single source of truth for the shape of `stock_ledger.lot` (schema.md §2.1) —
 * every ledger/receipt input schema reuses it so the four writers cannot drift.
 */
export const stockLotSchema = z.object({
	expiry: z.string().optional(),
	note: z.string().trim().optional(),
	lot_no: z.string().regex(LOT_NO_PATTERN, 'lot_no must look like L-YYMMDD-XXX').optional(),
	storage_zone: z.string().trim().max(100).optional()
});

/** `YYMMDD` of a date, in the caller's local time (the lot label is read by staff on site). */
export function lotDateStamp(date: Date): string {
	const yy = String(date.getFullYear() % 100).padStart(2, '0');
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	return `${yy}${mm}${dd}`;
}

/**
 * Mint the next `count` lot numbers for a day, continuing after whatever already
 * exists. `existing` is every `lot_no` already on that shelter's ledger — entries
 * from other days are ignored, so the caller may pass the lot unfiltered.
 *
 * Not atomic: two staff receiving in the same second can be handed the same
 * sequence. Accepted in CR-088 — the worst case is two lots sharing a label.
 */
export function nextLotNos(existing: readonly string[], date: Date, count: number): string[] {
	const stamp = lotDateStamp(date);
	const prefix = `L-${stamp}-`;
	let max = 0;
	for (const lot of existing) {
		if (!lot.startsWith(prefix)) continue;
		const seq = Number.parseInt(lot.slice(prefix.length), 10);
		if (Number.isFinite(seq) && seq > max) max = seq;
	}
	return Array.from(
		{ length: count },
		(_, i) => `${prefix}${String(max + i + 1).padStart(3, '0')}`
	);
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
	/**
	 * Destination shelter this request was handed to (CR-087). Set
	 * only alongside `status: 'redirected'`; the ticket the destination actually
	 * works from is a separate `donation_redirect` doc in THAT shelter's DB —
	 * scope isolation means a field here is invisible to them.
	 */
	redirect_to_shelter_code?: string | null;
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

export interface StockTransferItem {
	item_id: string;
	qty: string; // qty_str > 0, as dispatched by the source shelter
	unit: string;
	received_qty?: string; // qty_str >= 0, as counted at the destination
}

export interface StockTransfer extends BaseDoc {
	type: 'stock_transfer';
	from_shelter: string;
	to_shelter: string;
	items: StockTransferItem[];
	status: TransferStatus;
	timeline: {
		requested: TransferTimelineEvent;
		shipped?: TransferTimelineEvent;
		received?: TransferTimelineEvent;
	};
	notes?: string;
}

export type OperationsDoc = StockLedger | Donation | DonationCampaign | Purchase | StockTransfer;

// ---------------------------------------------------------------- stock_ledger

/**
 * CR-055 R2 — the one place `reason` → required `ref_id` prefix is defined.
 *
 * `null` means the row has no originating document and must carry no `ref_id`.
 * A CouchDB `_id` already names its own type (`donation:01J…`), so the pointer
 * is self-describing; this table is what stops a row from claiming one `reason`
 * while pointing at another kind of doc. Adding a source = adding a row here —
 * never re-derive the mapping with `if`s elsewhere.
 *
 * Exported so the audit script checks the same table it enforces.
 */
export const REF_PREFIX_BY_REASON: Record<LedgerReason, string | null> = {
	donation: 'donation:',
	purchase: 'purchase:',
	requisition: 'kitchen_requisition:',
	// T-13 mints these; nothing writes `stock_transfer` docs yet.
	transfer_in: 'stock_transfer:',
	transfer_out: 'stock_transfer:',
	adjust: null, // manual correction — no source document by definition
	distribute: null, // CR-055 Q-1: revisit when CR-059 gives distribution a doc
	receive: null // CR-055 Q-2: orphan enum value, kept but pinned to null
};

/**
 * Shared by the write guard (R1, below) and the receive form's pre-validation
 * (R9, `receiveInputSchema`) so both read the same table — the form only mirrors
 * the rule for the user's benefit; this schema is where it is enforced.
 */
function checkRefId(reason: LedgerReason, refId: string | null, ctx: z.RefinementCtx): void {
	const expected = REF_PREFIX_BY_REASON[reason];
	if (expected === null) {
		if (refId !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['ref_id'],
				message: `รายการประเภท '${reason}' ต้องไม่มีเลขอ้างอิง (ref_id ต้องเป็น null)`
			});
		}
		return;
	}
	if (!refId?.startsWith(expected)) {
		ctx.addIssue({
			code: 'custom',
			path: ['ref_id'],
			message: `รายการประเภท '${reason}' ต้องอ้างอิงเอกสารต้นทางที่ขึ้นต้นด้วย '${expected}'`
		});
	}
}

/**
 * Rows are append-only, so a wrong `ref_id` can never be corrected — the
 * invariant is enforced on the way IN and nowhere else. Read paths
 * (`stockBalance`, `calculateReserved`, `LedgerTable`) must keep tolerating
 * older rows that predate this rule (CR-055 R5).
 */
export const stockLedgerInputSchema = z
	.object({
		item_id: z.string().min(1),
		qty: qtyStrCoerceSignedNonZeroSchema,
		unit: z.string().trim().min(1),
		reason: ledgerReasonSchema,
		ref_id: z.string().nullable().default(null),
		lot: stockLotSchema.optional(),
		occurred_at: z.string().optional()
	})
	.superRefine((d, ctx) => checkRefId(d.reason, d.ref_id, ctx));
export type StockLedgerInput = z.input<typeof stockLedgerInputSchema>;

/** Full persisted stock_ledger contract used before signed-sum calculations. */
export const stockLedgerDocSchema = z
	.object({
		_id: z.string().regex(/^stock_ledger:/),
		_rev: z.string().optional(),
		type: z.literal('stock_ledger'),
		schema_v: z.union([z.literal(2), z.literal(3), z.literal(4)]),
		shelter_code: z.string().min(1),
		created_at: z.string().datetime(),
		updated_at: z.string().datetime(),
		created_by: z.string().min(1),
		item_id: z.string().min(1),
		qty: qtyStrSignedNonZeroSchema,
		unit: z.string().trim().min(1),
		reason: ledgerReasonSchema,
		ref_id: z.string().nullable(),
		lot: stockLotSchema.optional(),
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

/**
 * The single factory every `stock_ledger` writer must go through (CR-055 R7) —
 * it is where the `reason` ↔ `ref_id` invariant is enforced, so a writer that
 * assembles the doc by hand silently escapes it.
 *
 * `id` exists for callers that need the `_id` BEFORE the write, so they can
 * store it on another doc in the same `bulkDocs` batch — kitchen
 * `issueRequisition` puts them on `kitchen_requisition.ledger_ids`. Omit it and
 * `makeDoc` mints a ULID as usual.
 */
export function createStockLedger(
	input: StockLedgerInput,
	ctx: AuthorContext,
	id?: string
): StockLedger {
	const d = stockLedgerInputSchema.parse(input);
	return makeDoc(
		'stock_ledger',
		4,
		{
			item_id: d.item_id,
			qty: persistQty(d.qty),
			unit: d.unit,
			reason: d.reason,
			ref_id: d.ref_id,
			...(d.lot ? { lot: d.lot } : {}),
			occurred_at: d.occurred_at ?? now()
		},
		ctx,
		id
	);
}

export const receiveSourceSchema = z.enum([
	'donation', // บริจาค (ประชาชน / เอกชน / มูลนิธิ)
	'transfer_in', // โอนมาจากศูนย์อื่น
	'manual' // กรอกเอง / ปรับปรุงสต๊อก
]);
export type ReceiveSource = z.infer<typeof receiveSourceSchema>;

/**
 * What the inbound form calls a "source" and what the ledger calls a "reason"
 * are different vocabularies — this is the only translation between them, used
 * by both `createReceiveEntry` and the form's pre-validation (R9).
 *
 * TODO(T-13): `transfer_in` is here for schema completeness but is not wired to
 * a real transfer flow yet; inter-shelter transfers land via T-13's confirm
 * step, and until then the option is hidden in the form (CR-055 R4 / D-3).
 */
const REASON_BY_RECEIVE_SOURCE: Record<ReceiveSource, LedgerReason> = {
	donation: 'donation',
	transfer_in: 'transfer_in',
	manual: 'adjust'
};

/**
 * CR-055 R9 — mirrors the R1 invariant onto the schema the receive form
 * actually validates against, so a bad `ref_id` surfaces under the field
 * instead of throwing at mutation time as an opaque toast. `stockLedgerInputSchema`
 * stays the enforcement point; this is UX.
 */
export const receiveInputSchema = z
	.object({
		item_id: z.string().min(1),
		qty: qtyStrCoercePositiveSchema,
		unit: z.string().trim().min(1),
		source: receiveSourceSchema,
		ref_id: z.string().nullable().default(null),
		lot: stockLotSchema.optional(),
		occurred_at: z.string().optional()
	})
	.superRefine((d, ctx) => checkRefId(REASON_BY_RECEIVE_SOURCE[d.source], d.ref_id, ctx));
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
	return createStockLedger(
		{
			item_id: d.item_id,
			qty: d.qty,
			unit: d.unit,
			reason: REASON_BY_RECEIVE_SOURCE[d.source],
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
	// CR-055 R8/Q-1: handing goods out has no source document, so the type — not
	// just a runtime check — rules a value out. Revisit if CR-059 introduces one.
	ref_id: z.null().default(null),
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
	// CR-055 R8: a manual correction has no originating doc — the comment used to
	// say "always null" while the type still allowed a string.
	ref_id: z.null().default(null),
	lot: stockLotSchema.optional(),
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
		// 5 since CR-087 added redirect_to_shelter_code (4 was CR-080's revisions[]). A
		// walk-in has neither yet, but the version has to say which shape a reader should
		// expect — and the public writer (worker/inbound/donations.py) stamps the same.
		5,
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

/**
 * Forward-only transitions for a donation (schema.md §2.3).
 *
 * The CR-052 review chain is `declared → pending_review → verifying → received`,
 * with `redirected` / `rejected` branching out of the review step. `declared` keeps
 * its direct edge to `received` for the walk-in path (`createWalkInDonation`), which
 * is keyed by staff at the counter and never goes through public review.
 */
const DONATION_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
	declared: ['pending_review', 'received', 'expired', 'cancelled'],
	// `redirected` is terminal HERE — the destination shelter continues on its own
	// `donation_redirect` ticket, not on this doc (CR-087).
	pending_review: ['verifying', 'redirected', 'rejected', 'expired', 'cancelled'],
	verifying: ['received', 'cancelled'],
	received: [],
	redirected: [],
	rejected: [],
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
				lot: stockLotSchema.optional()
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

// ---------------------------------------------------------------- transfer

export const transferItemSchema = z.object({
	item_id: z.string().min(1),
	qty: qtyStrCoercePositiveSchema,
	unit: z.string().trim().min(1)
});

export const transferInputSchema = z.object({
	from_shelter: z.string().min(1),
	to_shelter: z.string().min(1),
	items: z.array(transferItemSchema).min(1, 'A transfer needs at least one item'),
	notes: z.string().trim().optional()
});
export type TransferInput = z.input<typeof transferInputSchema>;

export const receivedItemSchema = z.object({
	item_id: z.string().min(1),
	qty: qtyStrCoerceNonNegativeSchema
});
export type ReceivedItemInput = z.input<typeof receivedItemSchema>;

export const transferFilterSchema = z.object({
	status: transferStatusSchema.optional(),
	limit: z.number().int().positive().max(1000).default(50),
	skip: z.number().int().nonnegative().default(0),
	sort: z.enum(['created_at_desc', 'created_at_asc']).default('created_at_desc')
});
export type TransferFilter = z.input<typeof transferFilterSchema>;

export function createTransfer(input: TransferInput, ctx: AuthorContext): StockTransfer {
	const d = transferInputSchema.parse(input);
	return makeDoc(
		'stock_transfer',
		2,
		{
			from_shelter: d.from_shelter,
			to_shelter: d.to_shelter,
			items: d.items.map((i) => ({ ...i, qty: persistQty(i.qty) })),
			status: 'requested',
			timeline: {
				requested: { at: now(), by: ctx.createdBy }
			},
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx
	);
}

/**
 * Dispatches a transfer (changes status to shipped and creates corresponding transfer_out ledger entries).
 * This function returns both the updated Transfer document and the StockLedger entries that must be persisted.
 */
export function dispatchTransfer(
	transfer: StockTransfer,
	ctx: AuthorContext
): { transfer: StockTransfer; ledgers: StockLedger[] } {
	if (transfer.status !== 'requested') {
		throw new Error(`Cannot dispatch transfer in status "${transfer.status}"`);
	}

	const updatedTransfer: StockTransfer = {
		...transfer,
		status: 'shipped',
		timeline: {
			...transfer.timeline,
			shipped: { at: now(), by: ctx.createdBy }
		},
		updated_at: now()
	};

	const ledgers = transfer.items.map((item) =>
		createStockLedger(
			{
				item_id: item.item_id,
				qty: qtyNeg(qtyAbs(item.qty)), // ensure negative delta for transfer out
				unit: item.unit,
				reason: 'transfer_out',
				ref_id: transfer._id,
				occurred_at: now()
			},
			ctx
		)
	);

	return { transfer: updatedTransfer, ledgers };
}

/**
 * Receives a transfer (changes status to received and creates corresponding transfer_in ledger entries).
 * This function supports partial receipt by allowing the user to specify actual received quantities.
 */
export function receiveTransfer(
	transfer: StockTransfer,
	receivedItems: { item_id: string; qty: string | number }[],
	ctx: AuthorContext,
	notes?: string
): { transfer: StockTransfer; ledgers: StockLedger[] } {
	if (transfer.status !== 'shipped') {
		throw new Error(`Cannot receive transfer in status "${transfer.status}"`);
	}

	const receivedQtyMap = new Map(receivedItems.map((i) => [i.item_id, persistQty(i.qty)]));

	const updatedItems = transfer.items.map((item) => {
		const receivedQty = receivedQtyMap.get(item.item_id) ?? '0';
		if (qtyGt(receivedQty, item.qty)) {
			throw new Error(
				`Received quantity for item "${item.item_id}" (${receivedQty}) exceeds dispatched quantity (${item.qty})`
			);
		}
		return { ...item, received_qty: receivedQty };
	});

	const updatedTransfer: StockTransfer = {
		...transfer,
		items: updatedItems,
		status: 'received',
		timeline: {
			...transfer.timeline,
			received: { at: now(), by: ctx.createdBy }
		},
		updated_at: now(),
		...(notes ? { notes } : {})
	};

	const ledgers = updatedItems
		.filter((item) => qtyGt(item.received_qty, 0))
		.map((item) =>
			createStockLedger(
				{
					item_id: item.item_id,
					qty: qtyAbs(item.received_qty), // ensure positive delta for transfer in
					unit: item.unit,
					reason: 'transfer_in',
					ref_id: transfer._id,
					occurred_at: now()
				},
				ctx
			)
		);

	return { transfer: updatedTransfer, ledgers };
}

/**
 * Cancels a transfer before it has shipped. No ledger entries — nothing was
 * ever deducted from source stock, so there is nothing to return. Does not add
 * a `timeline` key (schema.md's `timeline` shape has no `cancelled` slot —
 * adding one is a persisted-doc shape change that needs its own CR); `status`
 * + `updated_at` (common envelope) already record the transition.
 */
export function cancelTransfer(transfer: StockTransfer): { transfer: StockTransfer } {
	if (transfer.status !== 'requested') {
		throw new Error(`Cannot cancel transfer in status "${transfer.status}"`);
	}

	const updatedTransfer: StockTransfer = {
		...transfer,
		status: 'cancelled',
		updated_at: now()
	};

	return { transfer: updatedTransfer };
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
/**
 * `_id`s of the donations that have already been keyed into stock.
 *
 * "Keyed" means a `donation` ledger row points at it, which after CR-055 R2 is
 * a reliable signal: `reason: 'donation'` can only carry a `donation:` id, so a
 * typo can no longer make a keyed donation look unkeyed (or unreserve someone
 * else's). Shared by `calculateReserved` and `keyableDonations` so the receive
 * form and the campaign board agree on what is still outstanding.
 */
export function keyedDonationIds(stockLedgers: StockLedger[]): Set<string> {
	const keyed = new Set<string>();
	for (const ledger of stockLedgers) {
		if (ledger.reason === 'donation' && ledger.ref_id) {
			keyed.add(ledger.ref_id);
		}
	}
	return keyed;
}

/**
 * Donations the receive form may still key stock against (CR-055 R4).
 *
 * Goods-in-kind only — a `money` donation never produces a ledger row. An
 * outstanding donation is one whose goods are arriving now; a `received` one was
 * marked as arrived but never keyed. Both still owe stock. `expired`, `cancelled`,
 * `redirected` and `rejected` are terminal, and anything already keyed would
 * double-count.
 */
export function keyableDonations(donations: Donation[], stockLedgers: StockLedger[]): Donation[] {
	const keyed = keyedDonationIds(stockLedgers);
	return donations.filter(
		(d) =>
			d.kind === 'items' &&
			(isDonationOutstanding(d.status) || d.status === 'received') &&
			!keyed.has(d._id)
	);
}

export function calculateReserved(
	donations: Donation[],
	stockLedgers: StockLedger[],
	campaignId?: string
): Map<string, string> {
	const keyed = keyedDonationIds(stockLedgers);

	const reserved = new Map<string, string>();
	for (const don of donations) {
		if (campaignId && don.campaign_id && don.campaign_id !== campaignId) continue;
		const isUnkeyedReceived = don.status === 'received' && !keyed.has(don._id);
		if (!isDonationOutstanding(don.status) && !isUnkeyedReceived) continue;
		for (const item of don.items ?? []) {
			const itemId =
				item.item_id || (item.free_text ? mapNeedItemHeuristic(item.free_text) : undefined);
			if (!itemId) continue;
			reserved.set(itemId, addQty(reserved.get(itemId) ?? '0', item.qty));
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
export const isStockTransfer = (d: unknown): d is StockTransfer =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'stock_transfer';

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

/**
 * Manual force cut-off of a single need (T-22 / CR-052 §1.6).
 *
 * Closing a need by hand stops donors mid-flow while the target is still short, so
 * CR-052 makes the reason mandatory: it is what the transparency report shows and
 * what the audit entry is written from. Enforcing it here rather than in the dialog
 * means no caller — board button, keyboard shortcut, future API — can close a need
 * with an empty explanation.
 *
 * Returns a new campaign; the caller persists it together with the audit entry.
 */
export function forceCutOffNeed(
	campaign: DonationCampaign,
	itemId: string,
	reason: string
): DonationCampaign {
	const trimmed = reason.trim();
	if (!trimmed) {
		throw new Error('Force cut-off requires a reason');
	}
	if (!campaign.needs.some((need) => need.item_id === itemId)) {
		throw new Error(`Campaign ${campaign._id} has no need for ${itemId}`);
	}
	return {
		...campaign,
		needs: campaign.needs.map((need) =>
			need.item_id === itemId ? { ...need, status: 'closed' as const } : need
		),
		updated_at: now()
	};
}

/**
 * Reopen a need staff had closed by hand (FR-36 — stock falling back under target
 * reopens automatically; this is the manual counterpart). No reason required: going
 * back to the campaign's declared target needs no justification.
 */
export function reopenNeed(campaign: DonationCampaign, itemId: string): DonationCampaign {
	if (!campaign.needs.some((need) => need.item_id === itemId)) {
		throw new Error(`Campaign ${campaign._id} has no need for ${itemId}`);
	}
	return {
		...campaign,
		needs: campaign.needs.map((need) =>
			need.item_id === itemId ? { ...need, status: 'open' as const } : need
		),
		updated_at: now()
	};
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
