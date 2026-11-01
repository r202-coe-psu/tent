import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	resolveReceivedShelter,
	routeErrorResponse,
	shelterDb
} from '$lib/server/donation-intake';
import { toReceivedRow } from '$lib/server/donation-rows';
import {
	buildBookingRefFindBody,
	buildLotLedgerFindBody,
	buildPhoneFindBody,
	buildReceivedViewQuery,
	decodeSearchCursor,
	DONATION_RECEIVED_VIEWS,
	encodeSearchCursor,
	LOT_LEDGER_PAGE_SIZE,
	normalizeSearchQuery,
	pageLotMatches,
	RECEIVED_PAGE_SIZE,
	receivedSearchInputSchema,
	type PublicDonationDoc,
	type ReceivedSearchBy,
	type SearchCursorState
} from '$lib/features/donations/server';
import { SHELTER_VIEW_MANIFEST } from '$lib/features/shelters/server';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';
import { sha256Hex } from '$lib/db/hash';

export const prerender = false;

/**
 * Search of the "รับแล้ว" list across the WHOLE shelter (#821 FR-8) — not just the pages the
 * screen has loaded. One search type per request, every type an exact match on the normalized
 * value, every read bounded by an index or a view (no `$regex`, no whole-shelter load).
 *
 * The term travels in the body, not the URL, so it never reaches an access log. It is not
 * logged by the app either (FR-8f). No rate limit on this route (FR-8e).
 *
 * The answer is the same masked row as the list (FR-10, AC-5a): a search lets staff confirm a
 * name or a number has a donation, it does not hand the full contact out. That is `POST
 * [query]/contact`, with an audit row.
 */

/** A `_find` index / view the database does not have yet: 503, never a scan. */
class IndexUnavailableError extends Error {}
/** CouchDB failed for another reason. */
class ReadFailedError extends Error {}

type Page = {
	docs: PublicDonationDoc[];
	/** What the next page starts from; `null` at the end. */
	next: SearchCursorState | null;
};

const isReceivedDonation = (d: PublicDonationDoc | null | undefined): d is PublicDonationDoc =>
	d?.type === 'donation' && d.status === 'received';

async function find(
	db: string,
	body: Record<string, unknown>
): Promise<{ docs: Array<Record<string, unknown>>; bookmark: string | null }> {
	const res = await adminRaw(`/${db}/_find`, 'POST', body);
	// A shelter whose database is not there has nothing received.
	if (res.status === 404) return { docs: [], bookmark: null };
	if (res.status >= 400) {
		const detail = (res.data as { error?: string } | null) ?? {};
		if (res.status === 400 && detail.error === 'no_usable_index') {
			throw new IndexUnavailableError();
		}
		throw new ReadFailedError();
	}
	const data =
		(res.data as { docs?: Array<Record<string, unknown>>; bookmark?: string } | null) ?? {};
	return { docs: data.docs ?? [], bookmark: data.bookmark ?? null };
}

/** `booking_ref` — at most one donation, no cursor. */
async function searchBookingRef(db: string, q: string): Promise<Page> {
	const { docs } = await find(db, buildBookingRefFindBody(q));
	return { docs: (docs as unknown as PublicDonationDoc[]).filter(isReceivedDonation), next: null };
}

/** `phone` — Mango bookmark paging; a full page means there may be more. */
async function searchPhone(
	db: string,
	phoneHash: string,
	state: SearchCursorState | null
): Promise<Page> {
	const { docs, bookmark } = await find(db, buildPhoneFindBody(phoneHash, state?.bm));
	// A full page only means "maybe more": one row past the bookmark settles it (no empty page).
	let next: SearchCursorState | null = null;
	if (docs.length === RECEIVED_PAGE_SIZE && bookmark !== null) {
		const probe = await find(db, { ...buildPhoneFindBody(phoneHash, bookmark), limit: 1 });
		if (probe.docs.length > 0) next = { bm: bookmark };
	}
	return {
		docs: (docs as unknown as PublicDonationDoc[]).filter(isReceivedDonation),
		next
	};
}

/**
 * `name` / `item` — a view read with a one-row lookahead (FR-8h): ask for 21, show 20; a 21st
 * row means another page and is exactly where it starts, so the pages neither repeat nor skip.
 */
async function searchView(
	db: string,
	view: string,
	q: string,
	state: SearchCursorState | null
): Promise<Page> {
	const deployment = await checkViewDeployment(db, adminRaw);
	if (deployment.state !== 'current') throw new IndexUnavailableError();

	const after = state?.key && state.docid ? { key: state.key, docid: state.docid } : null;
	const res = await adminRaw(
		`/${db}/_design/${SHELTER_VIEW_MANIFEST.designName}/_view/${view}?${buildReceivedViewQuery(q, after)}`,
		'GET'
	);
	if (res.status === 404) throw new IndexUnavailableError();
	if (res.status >= 400) throw new ReadFailedError();

	const rows =
		(
			res.data as {
				rows?: Array<{ id: string; key: Array<string | null>; doc?: PublicDonationDoc }>;
			} | null
		)?.rows ?? [];
	const lookahead = rows.length > RECEIVED_PAGE_SIZE ? rows[RECEIVED_PAGE_SIZE] : null;
	return {
		docs: rows
			.slice(0, RECEIVED_PAGE_SIZE)
			.map((r) => r.doc)
			.filter(isReceivedDonation),
		next: lookahead ? { key: lookahead.key, docid: lookahead.id } : null
	};
}

/** `_all_docs` keys per request while fetching the donations a lot number points at. */
const FETCH_CHUNK = 200;

/**
 * `lot` — FR-8d, in order: (1) every `donation` ledger row of the lot number, `limit` 200 a
 * round, following the bookmark to the end; (2) one id per donation; (3) fetch them, keep the
 * received ones; (4–5) sort newest first and cut the page after the cursor's `(received_at, _id)`.
 */
async function searchLot(
	db: string,
	lotNo: string,
	state: SearchCursorState | null
): Promise<Page> {
	const refIds = new Set<string>();
	let bookmark: string | null = null;
	for (;;) {
		const round: { docs: Array<Record<string, unknown>>; bookmark: string | null } = await find(
			db,
			buildLotLedgerFindBody(lotNo, bookmark)
		);
		for (const row of round.docs) {
			const refId = row.ref_id;
			if (
				row.type === 'stock_ledger' &&
				row.reason === 'donation' &&
				typeof refId === 'string' &&
				refId.startsWith('donation:')
			) {
				refIds.add(refId);
			}
		}
		if (round.docs.length < LOT_LEDGER_PAGE_SIZE) break;
		// A bookmark that does not move would loop forever on the same page.
		if (!round.bookmark || round.bookmark === bookmark) break;
		bookmark = round.bookmark;
	}

	const ids = [...refIds];
	const donations: PublicDonationDoc[] = [];
	for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
		const res = await adminRaw(`/${db}/_all_docs?include_docs=true`, 'POST', {
			keys: ids.slice(i, i + FETCH_CHUNK)
		});
		if (res.status >= 400) throw new ReadFailedError();
		const rows =
			(res.data as { rows?: Array<{ doc?: PublicDonationDoc | null }> } | null)?.rows ?? [];
		for (const row of rows) if (isReceivedDonation(row.doc)) donations.push(row.doc);
	}

	const { page, hasMore } = pageLotMatches(
		donations,
		state?.id ? { at: state.at ?? '', id: state.id } : null
	);
	const last = page.at(-1);
	return {
		docs: page,
		next: hasMore && last ? { at: last.received_at ?? '', id: last._id } : null
	};
}

/**
 * What each search type needs back from a cursor; one that lacks it is not ours. A view cursor's
 * key must start with the query itself: the cursor is not signed, and a hand-made `startkey`
 * outside `[q, …]` would read neighbouring names — a prefix search the CR forbids (FR-8, FR-8b).
 */
function cursorFits(by: ReceivedSearchBy, state: SearchCursorState, q: string): boolean {
	switch (by) {
		case 'booking_ref':
			return false;
		case 'phone':
			return Boolean(state.bm);
		case 'name':
		case 'item':
			return (
				Array.isArray(state.key) &&
				state.key.length === 2 &&
				state.key[0] === q &&
				typeof state.key[1] === 'string' &&
				Boolean(state.docid)
			);
		case 'lot':
			return Boolean(state.id);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));

		const parsed = receivedSearchInputSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return json(
				{
					success: false,
					error_code: 'INVALID_INPUT',
					error: 'Invalid input',
					details: parsed.error.flatten()
				},
				{ status: 422 }
			);
		}
		const input = parsed.data;

		const shelter = await resolveReceivedShelter(caller, input.shelter_code);
		if ('response' in shelter) return shelter.response;
		const { code } = shelter;

		const query = normalizeSearchQuery(input.by, input.q);
		if (!query.ok) {
			return json(
				{ success: false, error_code: query.code, error: query.message },
				{ status: 400 }
			);
		}

		const binding = { by: input.by, qh: await sha256Hex(query.q), shelter: code };
		let state: SearchCursorState | null = null;
		if (input.cursor) {
			const decoded = decodeSearchCursor(input.cursor, binding);
			if (!decoded.ok || !cursorFits(input.by, decoded.state, query.q)) {
				return json(
					{ success: false, error_code: 'INVALID_CURSOR', error: 'Invalid cursor' },
					{ status: 400 }
				);
			}
			state = decoded.state;
		}

		const db = shelterDb(code);
		let page: Page;
		try {
			switch (input.by) {
				case 'booking_ref':
					page = await searchBookingRef(db, query.q);
					break;
				case 'phone':
					// Hashed the way `donor.phone_hash` is written: sha256 of the normalized number.
					page = await searchPhone(db, binding.qh, state);
					break;
				case 'name':
					page = await searchView(db, DONATION_RECEIVED_VIEWS.name, query.q, state);
					break;
				case 'item':
					page = await searchView(db, DONATION_RECEIVED_VIEWS.item, query.q, state);
					break;
				case 'lot':
					page = await searchLot(db, query.q, state);
					break;
			}
		} catch (e) {
			if (e instanceof IndexUnavailableError) {
				return json({ success: false, error: 'DONATION_INDEX_UNAVAILABLE' }, { status: 503 });
			}
			if (e instanceof ReadFailedError) {
				return json({ success: false, error: 'Could not read donations' }, { status: 502 });
			}
			throw e;
		}

		// FR-8f: who searched where and how many it found — never the term, a name or a number.
		console.info(
			JSON.stringify({
				event: 'donation_received_search',
				user: caller.name,
				shelter_code: code,
				by: input.by,
				result_count: page.docs.length,
				at: new Date().toISOString()
			})
		);

		return json({
			success: true,
			donations: page.docs.map(toReceivedRow),
			cursor: page.next ? encodeSearchCursor(binding, page.next) : null,
			has_more: page.next !== null
		});
	} catch (e) {
		const { message, status } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status });
	}
};
