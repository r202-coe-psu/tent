import { describe, expect, it } from 'vitest';
import {
	buildBookingRefFindBody,
	buildLotLedgerFindBody,
	buildPhoneFindBody,
	buildReceivedViewQuery,
	decodeSearchCursor,
	encodeSearchCursor,
	normalizeDonorNameKey,
	normalizeSearchQuery,
	pageLotMatches,
	receivedSearchInputSchema
} from './received-search';

describe('normalizeDonorNameKey', () => {
	it.each([
		['สมชาย ใจดี', 'สมชาย ใจดี'],
		[' สมชาย  ใจดี ', 'สมชาย ใจดี'],
		['JOHN   Smith', 'john smith'],
		['ＪＯＨＮ', 'john'],
		['a b', 'a b']
	])('%j → %j', (input, expected) => {
		expect(normalizeDonorNameKey(input)).toBe(expected);
	});
});

describe('receivedSearchInputSchema', () => {
	it('trims q and accepts the five search types', () => {
		for (const by of ['booking_ref', 'name', 'phone', 'item', 'lot']) {
			const r = receivedSearchInputSchema.safeParse({ by, q: '  x  ' });
			expect(r.success).toBe(true);
			if (r.success) expect(r.data.q).toBe('x');
		}
	});

	it.each([
		['unknown by', { by: 'regex', q: 'x' }],
		['empty q', { by: 'name', q: '   ' }],
		['q over 200', { by: 'name', q: 'x'.repeat(201) }],
		['cursor over 2048', { by: 'name', q: 'x', cursor: 'c'.repeat(2049) }],
		['empty cursor', { by: 'name', q: 'x', cursor: '' }]
	])('rejects %s', (_label, body) => {
		expect(receivedSearchInputSchema.safeParse(body).success).toBe(false);
	});

	it('accepts q of exactly 200 and a cursor of exactly 2048', () => {
		expect(
			receivedSearchInputSchema.safeParse({
				by: 'name',
				q: 'x'.repeat(200),
				cursor: 'c'.repeat(2048)
			}).success
		).toBe(true);
	});
});

describe('normalizeSearchQuery (AC-6a)', () => {
	const name = (q: string) => normalizeSearchQuery('name', q);

	it.each(['ใจดี', 'สมชาย', 'สมชาย ใจดี', ' สมชาย  ใจดี '])('name %j is a lookup key', (q) => {
		const r = name(q);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.q).toBe(normalizeDonorNameKey(q));
	});

	it.each(['0812345678', '081-234-5678', '+66812345678', '081 234 5678', '(081)2345678'])(
		'phone %j normalizes to 0812345678',
		(q) => {
			expect(normalizeSearchQuery('phone', q)).toEqual({ ok: true, q: '0812345678' });
		}
	);

	it.each(['5678', '081234', '08123456789', 'abcdefghij', '1812345678'])(
		'phone %j is INVALID_PHONE',
		(q) => {
			expect(normalizeSearchQuery('phone', q)).toMatchObject({ ok: false, code: 'INVALID_PHONE' });
		}
	);

	it.each(['L-261029-001', ' l-261029-001 '])('lot %j is accepted, upper-cased', (q) => {
		expect(normalizeSearchQuery('lot', q)).toEqual({ ok: true, q: 'L-261029-001' });
	});

	it.each(['261029-001', 'L-26102-001', 'L-261029-01', 'L-261029-0011', 'lot'])(
		'lot %j is INVALID_LOT',
		(q) => {
			expect(normalizeSearchQuery('lot', q)).toMatchObject({ ok: false, code: 'INVALID_LOT' });
		}
	);

	it('trims a booking ref and upper-cases it (typed off a ticket in any case); keeps an item id as typed', () => {
		expect(normalizeSearchQuery('booking_ref', ' DN-306892 ')).toEqual({
			ok: true,
			q: 'DN-306892'
		});
		expect(normalizeSearchQuery('booking_ref', 'dn-306892')).toEqual({
			ok: true,
			q: 'DN-306892'
		});
		expect(normalizeSearchQuery('item', 'item_master:rice')).toEqual({
			ok: true,
			q: 'item_master:rice'
		});
	});
});

describe('search cursor', () => {
	const binding = { by: 'name', qh: 'abc123', shelter: 'SH001' } as const;

	it('is base64url of JSON { v: 1, by, qh, … } — opaque, URL-safe', () => {
		const cursor = encodeSearchCursor(binding, {
			key: ['สมชาย', '2026-10-20T03:00:00.000Z'],
			docid: 'donation:w021'
		});
		expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
		const json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		expect(json).toMatchObject({ v: 1, by: 'name', qh: 'abc123', docid: 'donation:w021' });
	});

	it('round-trips the paging state for the request it was issued for', () => {
		const state = { key: ['สมชาย', '2026-10-20T03:00:00.000Z'], docid: 'donation:w021' };
		const decoded = decodeSearchCursor(encodeSearchCursor(binding, state), binding);
		expect(decoded).toEqual({ ok: true, state });
	});

	it('refuses a cursor issued for another q (AC-6e)', () => {
		const cursor = encodeSearchCursor(binding, { bm: 'x' });
		expect(decodeSearchCursor(cursor, { ...binding, qh: 'other' })).toEqual({
			ok: false,
			code: 'INVALID_CURSOR'
		});
	});

	it('refuses a cursor issued for another search type', () => {
		const cursor = encodeSearchCursor(binding, { bm: 'x' });
		expect(decodeSearchCursor(cursor, { ...binding, by: 'item' }).ok).toBe(false);
	});

	it('refuses a cursor issued for another shelter', () => {
		const cursor = encodeSearchCursor(binding, { bm: 'x' });
		expect(decodeSearchCursor(cursor, { ...binding, shelter: 'SH002' }).ok).toBe(false);
	});

	it.each([
		['not base64', '%%%'],
		['not json', Buffer.from('hello').toString('base64url')],
		[
			'wrong version',
			Buffer.from(JSON.stringify({ v: 2, by: 'name', qh: 'a', sh: 'SH001' })).toString('base64url')
		],
		['missing binding', Buffer.from(JSON.stringify({ v: 1 })).toString('base64url')],
		['invalid utf-8', '_w']
	])('treats a malformed cursor (%s) as INVALID_CURSOR', (_label, raw) => {
		expect(decodeSearchCursor(raw, binding)).toEqual({ ok: false, code: 'INVALID_CURSOR' });
	});
});

describe('pageLotMatches (FR-8d steps 4-5, AC-6d)', () => {
	const donation = (n: number, at: string) => ({
		_id: `donation:${String(n).padStart(3, '0')}`,
		received_at: at
	});
	const time = (n: number) => `2026-10-${String(n).padStart(2, '0')}T00:00:00.000Z`;

	it('25 donations: 20 then 5, newest first, no repeats or gaps', () => {
		const all = Array.from({ length: 25 }, (_, i) => donation(i, time(i + 1)));
		const first = pageLotMatches(all, null);
		expect(first.page).toHaveLength(20);
		expect(first.hasMore).toBe(true);
		expect(first.page[0]._id).toBe('donation:024');

		const last = first.page.at(-1)!;
		const second = pageLotMatches(all, { at: last.received_at, id: last._id });
		expect(second.page).toHaveLength(5);
		expect(second.hasMore).toBe(false);

		const ids = [...first.page, ...second.page].map((d) => d._id);
		expect(new Set(ids).size).toBe(25);
		expect(ids).toEqual(all.map((d) => d._id).reverse());
	});

	it('breaks received_at ties on _id, larger first, across the page boundary', () => {
		const same = time(5);
		const all = Array.from({ length: 22 }, (_, i) => donation(i, same));
		const first = pageLotMatches(all, null, 20);
		expect(first.page.map((d) => d._id)[0]).toBe('donation:021');
		const last = first.page.at(-1)!;
		expect(last._id).toBe('donation:002');

		const second = pageLotMatches(all, { at: last.received_at, id: last._id });
		expect(second.page.map((d) => d._id)).toEqual(['donation:001', 'donation:000']);
		expect(second.hasMore).toBe(false);
	});

	it('lists a donation once even when it is passed twice', () => {
		const d = donation(1, time(1));
		expect(pageLotMatches([d, d, d], null).page).toHaveLength(1);
	});

	it('is empty past the last row', () => {
		const result = pageLotMatches([donation(1, time(1))], { at: time(1), id: 'donation:001' });
		expect(result).toEqual({ page: [], hasMore: false });
	});
});

describe('query builders (AC-6)', () => {
	it('phone: Mango find on the phone index, bounded, bookmark paged, no $regex / skip', () => {
		const body = buildPhoneFindBody('hash-1', 'bm-1');
		expect(body).toEqual({
			selector: { type: 'donation', status: 'received', 'donor.phone_hash': 'hash-1' },
			sort: [
				{ type: 'desc' },
				{ status: 'desc' },
				{ 'donor.phone_hash': 'desc' },
				{ received_at: 'desc' }
			],
			use_index: ['_design/donation-received-phone', 'donation-received-phone'],
			allow_fallback: false,
			limit: 20,
			bookmark: 'bm-1'
		});
		expect(buildPhoneFindBody('hash-1')).not.toHaveProperty('bookmark');
	});

	it('lot: ledger find on the lot index, 200 a round, donation rows only', () => {
		expect(buildLotLedgerFindBody('L-261029-001')).toEqual({
			selector: { type: 'stock_ledger', 'lot.lot_no': 'L-261029-001', reason: 'donation' },
			use_index: ['_design/stock-ledger-lot-no', 'stock-ledger-lot-no'],
			allow_fallback: false,
			limit: 200
		});
		expect(buildLotLedgerFindBody('L-261029-001', 'bm')).toMatchObject({ bookmark: 'bm' });
	});

	it('booking_ref: exact match pinned to the (type, booking_ref) index', () => {
		const body = buildBookingRefFindBody('DN-306892');
		expect(body.selector).toEqual({ type: 'donation', booking_ref: 'DN-306892' });
		expect(body.use_index).toEqual(['_design/donation-booking-ref', 'donation-booking-ref']);
		expect(body.allow_fallback).toBe(false);
	});

	it('view, first page: descending from [q, {}] to [q], limit 21 (lookahead), no skip', () => {
		const params = new URLSearchParams(buildReceivedViewQuery('สมชาย', null));
		expect(params.get('descending')).toBe('true');
		expect(params.get('include_docs')).toBe('true');
		expect(params.get('limit')).toBe('21');
		expect(JSON.parse(params.get('startkey')!)).toEqual(['สมชาย', {}]);
		expect(JSON.parse(params.get('endkey')!)).toEqual(['สมชาย']);
		expect(params.has('startkey_docid')).toBe(false);
		expect(params.has('skip')).toBe(false);
	});

	it('view, next page: startkey and startkey_docid from the cursor, same endkey', () => {
		const params = new URLSearchParams(
			buildReceivedViewQuery('สมชาย', {
				key: ['สมชาย', '2026-10-20T03:00:00.000Z'],
				docid: 'donation:w005'
			})
		);
		expect(JSON.parse(params.get('startkey')!)).toEqual(['สมชาย', '2026-10-20T03:00:00.000Z']);
		expect(params.get('startkey_docid')).toBe('donation:w005');
		expect(JSON.parse(params.get('endkey')!)).toEqual(['สมชาย']);
		expect(params.get('limit')).toBe('21');
	});
});
