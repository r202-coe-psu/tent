import { z } from 'zod';
import { normalizeThaiPhone } from '$lib/db/model';
import { LOT_NO_PATTERN } from '$lib/features/operations/server';
import { RECEIVED_PAGE_SIZE } from './donation-queue';

/**
 * Server-side search of the "รับแล้ว" list (#821 FR-8): one search type at a time, every type an
 * exact match on the normalized value, every read bounded by an index or a view — never a
 * `$regex`, never the whole shelter loaded and filtered in the app.
 *
 * Pure: no I/O. The route (`api/back-office/donations/received/search`) does the reads.
 */

export const RECEIVED_SEARCH_BY = ['booking_ref', 'name', 'phone', 'item', 'lot'] as const;
export type ReceivedSearchBy = (typeof RECEIVED_SEARCH_BY)[number];

export const RECEIVED_SEARCH_Q_MAX = 200;
export const RECEIVED_SEARCH_CURSOR_MAX = 2048;

/** Body of `POST /api/back-office/donations/received/search`. */
export const receivedSearchInputSchema = z.object({
	shelter_code: z.string().trim().min(1).optional(),
	by: z.enum(RECEIVED_SEARCH_BY),
	q: z.string().trim().min(1).max(RECEIVED_SEARCH_Q_MAX),
	cursor: z.string().min(1).max(RECEIVED_SEARCH_CURSOR_MAX).optional()
});
export type ReceivedSearchInput = z.infer<typeof receivedSearchInputSchema>;

// ---------------------------------------------------------------------------- normalization

/**
 * The key a donor name is searched by: NFKC → lowercase → trim → collapse runs of spaces.
 * The `donation_received_by_name` view applies the same steps to `donor.name` — change one
 * and the other together, or every name search stops matching.
 */
export function normalizeDonorNameKey(value: string): string {
	return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

export type ReceivedSearchErrorCode = 'INVALID_QUERY' | 'INVALID_PHONE' | 'INVALID_LOT';

export type NormalizedSearchQuery =
	{ ok: true; q: string } | { ok: false; code: ReceivedSearchErrorCode; message: string };

const PHONE_PATTERN = /^0\d{9}$/;

/** Validate and normalize `q` for the search type. The result is what is looked up. */
export function normalizeSearchQuery(by: ReceivedSearchBy, raw: string): NormalizedSearchQuery {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, code: 'INVALID_QUERY', message: 'q is required' };
	switch (by) {
		case 'booking_ref':
			// Refs are minted upper-case (`DN-306892`); staff may type them off a ticket in any case.
			return { ok: true, q: trimmed.toUpperCase() };
		case 'item':
			return { ok: true, q: trimmed };
		case 'name': {
			const key = normalizeDonorNameKey(trimmed);
			return key
				? { ok: true, q: key }
				: { ok: false, code: 'INVALID_QUERY', message: 'q is required' };
		}
		case 'phone': {
			const phone = normalizeThaiPhone(trimmed);
			return PHONE_PATTERN.test(phone)
				? { ok: true, q: phone }
				: { ok: false, code: 'INVALID_PHONE', message: 'Phone must be 10 digits starting with 0' };
		}
		case 'lot': {
			const lot = trimmed.toUpperCase();
			return LOT_NO_PATTERN.test(lot)
				? { ok: true, q: lot }
				: { ok: false, code: 'INVALID_LOT', message: 'Lot number must look like L-YYMMDD-XXX' };
		}
	}
}

// ---------------------------------------------------------------------------- cursor

/** What a cursor is bound to: the search it was issued for. */
export type CursorBinding = { by: ReceivedSearchBy; qh: string; shelter: string };

const cursorBodySchema = z.object({
	v: z.literal(1),
	by: z.enum(RECEIVED_SEARCH_BY),
	qh: z.string().min(1).max(128),
	sh: z.string().min(1).max(128),
	/** `phone`: CouchDB bookmark of the Mango index. */
	bm: z.string().min(1).max(1024).optional(),
	/** `name` / `item`: view key and docid of the lookahead row (FR-8h). */
	key: z
		.array(z.union([z.string(), z.null()]))
		.max(2)
		.optional(),
	docid: z.string().min(1).max(512).optional(),
	/** `lot`: `(received_at, _id)` of the last row of the page (FR-8d step 5). */
	at: z.string().max(64).optional(),
	id: z.string().min(1).max(512).optional()
});
export type SearchCursorBody = z.infer<typeof cursorBodySchema>;
/** The paging state a cursor carries, without the binding. */
export type SearchCursorState = Omit<SearchCursorBody, 'v' | 'by' | 'qh' | 'sh'>;

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
	const padded = value.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	return new TextDecoder('utf-8', { fatal: true }).decode(
		Uint8Array.from(binary, (c) => c.charCodeAt(0))
	);
}

/** Opaque cursor: base64url of JSON `{ v: 1, by, qh, … }` (FR-8a). `qh` = sha256 hex of the normalized `q`. */
export function encodeSearchCursor(binding: CursorBinding, state: SearchCursorState): string {
	const body: SearchCursorBody = {
		v: 1,
		by: binding.by,
		qh: binding.qh,
		sh: binding.shelter,
		...state
	};
	return toBase64Url(JSON.stringify(body));
}

export type DecodedCursor =
	{ ok: true; state: SearchCursorState } | { ok: false; code: 'INVALID_CURSOR' };

/**
 * Read a cursor back. Malformed, or issued for another `by` / `q` / shelter → `INVALID_CURSOR`
 * (a 400): a cursor from one search must not steer another.
 */
export function decodeSearchCursor(raw: string, expected: CursorBinding): DecodedCursor {
	const invalid = { ok: false, code: 'INVALID_CURSOR' } as const;
	let parsed: unknown;
	try {
		parsed = JSON.parse(fromBase64Url(raw));
	} catch {
		return invalid;
	}
	const body = cursorBodySchema.safeParse(parsed);
	if (!body.success) return invalid;
	const { by, qh, sh, ...state } = body.data;
	delete (state as { v?: unknown }).v;
	if (by !== expected.by || qh !== expected.qh || sh !== expected.shelter) return invalid;
	return { ok: true, state };
}

// ---------------------------------------------------------------------------- lot paging

export type LotMatch = { _id: string; received_at?: string | null };

/** Newest `received_at` first; equal times by `_id`, larger first (FR-8a). */
export function compareLotMatches(a: LotMatch, b: LotMatch): number {
	const at = a.received_at ?? '';
	const bt = b.received_at ?? '';
	if (at !== bt) return at < bt ? 1 : -1;
	if (a._id === b._id) return 0;
	return a._id < b._id ? 1 : -1;
}

/**
 * Steps 4–5 of FR-8d: sort the donations that carry the lot, drop everything up to and
 * including the cursor tuple, and cut one page. The tuple is `(received_at, _id)` of the last
 * row of the previous page, so two donations with the same `received_at` split across a page
 * boundary neither repeat nor vanish. A donation listed twice appears once.
 */
export function pageLotMatches<T extends LotMatch>(
	docs: readonly T[],
	after: { at: string; id: string } | null,
	size: number = RECEIVED_PAGE_SIZE
): { page: T[]; hasMore: boolean } {
	const unique = [...new Map(docs.map((d) => [d._id, d])).values()].sort(compareLotMatches);
	const rest = after
		? unique.filter((d) => compareLotMatches(d, { _id: after.id, received_at: after.at }) > 0)
		: unique;
	return { page: rest.slice(0, size), hasMore: rest.length > size };
}

// ---------------------------------------------------------------------------- query builders

/** Mango index of the phone search (`DONATION_RECEIVED_PHONE_MANGO_INDEX`). */
export const DONATION_PHONE_INDEX = {
	ddoc: '_design/donation-received-phone',
	name: 'donation-received-phone'
} as const;

/** Mango index of the booking-ref search (`DONATION_BOOKING_REF_MANGO_INDEX`). */
export const DONATION_BOOKING_REF_INDEX = {
	ddoc: '_design/donation-booking-ref',
	name: 'donation-booking-ref'
} as const;

/** Mango index of the lot search (`STOCK_LEDGER_LOT_NO_MANGO_INDEX`). */
export const STOCK_LEDGER_LOT_INDEX = {
	ddoc: '_design/stock-ledger-lot-no',
	name: 'stock-ledger-lot-no'
} as const;

/** `stock_ledger` rows per `_find` round of the lot search (FR-8d step 1). */
export const LOT_LEDGER_PAGE_SIZE = 200;

/** Views of `_design/app` the name and item searches read (view manifest v7). */
export const DONATION_RECEIVED_VIEWS = {
	name: 'donation_received_by_name',
	item: 'donation_received_by_item'
} as const;

/**
 * `booking_ref` — exact match on the `(type, booking_ref)` index. The status is checked by the
 * caller, not the selector: the ref is unique, so the index already narrows to one donation.
 */
export function buildBookingRefFindBody(bookingRef: string) {
	return {
		selector: { type: 'donation', booking_ref: bookingRef },
		use_index: [DONATION_BOOKING_REF_INDEX.ddoc, DONATION_BOOKING_REF_INDEX.name],
		allow_fallback: false,
		// `booking_ref` is unique per donation; 2 keeps a duplicate visible instead of hiding it.
		limit: 2
	};
}

/** `phone` — `donor.phone_hash` equality, newest first, paged by the Mango bookmark. */
export function buildPhoneFindBody(phoneHash: string, bookmark?: string | null) {
	return {
		selector: {
			type: 'donation',
			status: 'received',
			'donor.phone_hash': phoneHash
		},
		sort: [
			{ type: 'desc' },
			{ status: 'desc' },
			{ 'donor.phone_hash': 'desc' },
			{ received_at: 'desc' }
		],
		use_index: [DONATION_PHONE_INDEX.ddoc, DONATION_PHONE_INDEX.name],
		allow_fallback: false,
		limit: RECEIVED_PAGE_SIZE,
		...(bookmark ? { bookmark } : {})
	};
}

/** `lot` step 1 — the `donation` ledger rows carrying this lot number. */
export function buildLotLedgerFindBody(lotNo: string, bookmark?: string | null) {
	return {
		selector: { type: 'stock_ledger', 'lot.lot_no': lotNo, reason: 'donation' },
		use_index: [STOCK_LEDGER_LOT_INDEX.ddoc, STOCK_LEDGER_LOT_INDEX.name],
		allow_fallback: false,
		limit: LOT_LEDGER_PAGE_SIZE,
		...(bookmark ? { bookmark } : {})
	};
}

/**
 * `name` / `item` — query string of the view read. Newest first: `descending`, from
 * `[q, {}]` down to `[q]`. `limit` is one more than a page (FR-8h lookahead): the extra row
 * says whether a next page exists and is where it starts, so `startkey` / `startkey_docid`
 * replace `skip`.
 */
export function buildReceivedViewQuery(
	q: string,
	after: { key: readonly (string | null)[]; docid: string } | null
): string {
	const params = new URLSearchParams({
		descending: 'true',
		include_docs: 'true',
		limit: String(RECEIVED_PAGE_SIZE + 1),
		startkey: JSON.stringify(after ? after.key : [q, {}]),
		endkey: JSON.stringify([q])
	});
	if (after) params.set('startkey_docid', after.docid);
	return params.toString();
}
