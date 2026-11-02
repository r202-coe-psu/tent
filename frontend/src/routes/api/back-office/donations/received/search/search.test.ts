import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as route from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

const { POST } = route;
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

type Doc = Record<string, unknown> & { _id: string };
type FindBody = {
	selector: Record<string, unknown>;
	use_index: unknown;
	allow_fallback: boolean;
	limit: number;
	bookmark?: string;
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const time = (n: number) => `2026-10-${String(n).padStart(2, '0')}T00:00:00.000Z`;

const donation = (n: number, over: Record<string, unknown> = {}): Doc => ({
	_id: `donation:w${String(n).padStart(3, '0')}`,
	type: 'donation',
	status: 'received',
	channel: 'walk_in',
	shelter_code: 'SH001',
	booking_ref: `DN-${String(n).padStart(6, '0')}`,
	donor: {
		name: 'สมชาย ใจดี',
		phone: '0812345678',
		phone_hash: sha256('0812345678'),
		email: 'somchai@example.com'
	},
	items: [{ item_id: 'item_master:rice', qty: '1', unit: 'kg' }],
	tracking_token_hash: 'th-secret',
	received_at: time(10),
	...over
});

const ids = (data: { donations: Array<{ donation_id: string }> }) =>
	data.donations.map((d) => d.donation_id);

/**
 * A small fake of the three CouchDB reads the route makes. `views` hold the rows a view
 * would hold (key + docid), read back with the same startkey / startkey_docid / limit rules.
 */
type Fake = {
	registry?: string[];
	designVersion?: number | null | 'missing';
	viewRows?: Record<string, Array<{ id: string; key: unknown[] }>>;
	docs?: Record<string, Doc>;
	/** `_find` answers by selector kind: a function gets the body and returns the response. */
	find?: (body: FindBody) => { status?: number; data: unknown };
};

function mockCouch(fake: Fake) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string, body?: unknown) => {
		if (path.startsWith('/registry/')) {
			const codes = fake.registry ?? ['SH001', 'SH002'];
			return Promise.resolve({
				status: 200,
				data: { rows: codes.map((code) => ({ id: `shelter:${code}`, doc: { code } })) }
			});
		}
		if (/\/_design\/app$/.test(path)) {
			if (fake.designVersion === 'missing') return Promise.resolve({ status: 404, data: {} });
			return Promise.resolve({
				status: 200,
				data: { tent_view: { version: fake.designVersion ?? 7 } }
			});
		}
		const view = /\/_design\/app\/_view\/([a-z_]+)\?(.*)$/.exec(path);
		if (view) {
			const rows = fake.viewRows?.[view[1]];
			if (!rows) return Promise.resolve({ status: 404, data: { error: 'not_found' } });
			const q = new URLSearchParams(view[2]);
			const startkey = JSON.parse(q.get('startkey')!) as unknown[];
			const endkey = JSON.parse(q.get('endkey')!) as unknown[];
			const startDocid = q.get('startkey_docid');
			// descending: by key desc, then docid desc.
			const sorted = [...rows].sort(
				(a, b) => String(b.key[1]).localeCompare(String(a.key[1])) || b.id.localeCompare(a.id)
			);
			const out = sorted.filter((r) => {
				if (r.key[0] !== endkey[0]) return false;
				if (startkey[1] === undefined || typeof startkey[1] === 'object') return true;
				const cmp = String(r.key[1]).localeCompare(String(startkey[1]));
				if (cmp !== 0) return cmp < 0;
				return startDocid ? r.id.localeCompare(startDocid) <= 0 : true;
			});
			const limit = Number(q.get('limit'));
			return Promise.resolve({
				status: 200,
				data: {
					rows: out.slice(0, limit).map((r) => ({ ...r, doc: fake.docs?.[r.id] ?? null }))
				}
			});
		}
		if (path.endsWith('/_find')) {
			const res = fake.find?.(body as FindBody) ?? { data: { docs: [] } };
			return Promise.resolve({ status: res.status ?? 200, data: res.data });
		}
		if (path.includes('/_all_docs')) {
			const keys = (body as { keys: string[] }).keys;
			return Promise.resolve({
				status: 200,
				data: {
					rows: keys.map((k) =>
						fake.docs?.[k] ? { id: k, key: k, doc: fake.docs[k] } : { key: k, error: 'not_found' }
					)
				}
			});
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

const search = (body: unknown) =>
	POST({
		request: {
			headers: { get: () => 'session-cookie' },
			json: () =>
				body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)
		}
	} as unknown as PostEvent);

const asCaller = (roles: string[], shelterCode: string | null, isSA = false) =>
	vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
		name: 'warehouse01',
		roles,
		isSA,
		shelterCode
	});

const calls = (needle: string) =>
	vi.mocked(adminRaw).mock.calls.filter((c) => String(c[0]).includes(needle));

describe('POST /api/back-office/donations/received/search (#821 FR-8)', () => {
	let info: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.resetAllMocks();
		info = vi.spyOn(console, 'info').mockImplementation(() => {});
		asCaller(['shelter:SH001', 'warehouse_staff'], 'SH001');
	});
	afterEach(() => info.mockRestore());

	it('exports POST only (a GET is a 405) and is never prerendered', () => {
		expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(['POST']);
		expect(route.prerender).toBe(false);
	});

	describe('access (AC-5, FR-9 / FR-9a)', () => {
		it('403 for a caller without a warehouse capability, and nothing is read', async () => {
			asCaller(['shelter:SH001', 'registration_staff'], 'SH001');
			mockCouch({});

			expect((await search({ by: 'name', q: 'สมชาย' })).status).toBe(403);
			expect(vi.mocked(adminRaw)).not.toHaveBeenCalled();
		});

		it('403 for a scoped caller naming another shelter', async () => {
			mockCouch({});

			const res = await search({ shelter_code: 'SH002', by: 'name', q: 'สมชาย' });

			expect(res.status).toBe(403);
			expect(calls('shelter_sh002')).toHaveLength(0);
		});

		it.each([['shelter_manager'], ['warehouse_staff']])('lets a %s in', async (cap) => {
			asCaller(['shelter:SH001', cap], 'SH001');
			mockCouch({ viewRows: { donation_received_by_name: [] } });

			expect((await search({ by: 'name', q: 'สมชาย' })).status).toBe(200);
		});

		it('a system admin must name the shelter (400), and an unregistered one is a 404', async () => {
			asCaller(['system_admin'], null, true);
			mockCouch({ viewRows: { donation_received_by_name: [] } });

			expect((await search({ by: 'name', q: 'สมชาย' })).status).toBe(400);
			expect((await search({ shelter_code: 'SH999', by: 'name', q: 'สมชาย' })).status).toBe(404);
			expect((await search({ shelter_code: 'SH002', by: 'name', q: 'สมชาย' })).status).toBe(200);
			expect(calls('shelter_sh002').length).toBeGreaterThan(0);
			expect(calls('shelter_sh999')).toHaveLength(0);
		});
	});

	describe('input', () => {
		it.each([
			['no body', undefined],
			['unknown by', { by: 'regex', q: 'x' }],
			['missing q', { by: 'name' }],
			['blank q', { by: 'name', q: '   ' }],
			['q over 200 characters', { by: 'name', q: 'x'.repeat(201) }],
			['cursor over 2048 characters', { by: 'name', q: 'x', cursor: 'c'.repeat(2049) }]
		])('422 for %s', async (_label, body) => {
			mockCouch({});

			expect((await search(body)).status).toBe(422);
			expect(calls('_find')).toHaveLength(0);
		});

		it.each(['5678', '081234', '12345678901', 'abcdefghij'])(
			'400 INVALID_PHONE for phone %j, no read',
			async (q) => {
				mockCouch({});

				const res = await search({ by: 'phone', q });

				expect(res.status).toBe(400);
				expect((await res.json()).error_code).toBe('INVALID_PHONE');
				expect(calls('_find')).toHaveLength(0);
			}
		);

		it.each(['L-26102-001', '261029-001', 'lot'])('400 INVALID_LOT for lot %j', async (q) => {
			mockCouch({});

			const res = await search({ by: 'lot', q });

			expect(res.status).toBe(400);
			expect((await res.json()).error_code).toBe('INVALID_LOT');
		});

		it('400 INVALID_CURSOR for a malformed cursor', async () => {
			mockCouch({ viewRows: { donation_received_by_name: [] } });

			const res = await search({ by: 'name', q: 'สมชาย', cursor: 'not-a-cursor' });

			expect(res.status).toBe(400);
			expect((await res.json()).error_code).toBe('INVALID_CURSOR');
		});

		it('booking_ref has no cursor: one sent is a 400', async () => {
			mockCouch({});
			const res = await search({ by: 'booking_ref', q: 'DN-000001', cursor: 'x' });
			expect(res.status).toBe(400);
		});
	});

	describe('booking_ref (AC-4)', () => {
		it('exact selector pinned to the received index, newest-first sort, never a scan', async () => {
			mockCouch({ find: () => ({ data: { docs: [donation(1)] } }) });

			const data = await (await search({ by: 'booking_ref', q: ' DN-000001 ' })).json();

			expect(ids(data)).toEqual(['donation:w001']);
			expect(data).toMatchObject({ cursor: null, has_more: false });
			const [path, method, body] = calls('_find')[0];
			expect(path).toBe('/shelter_sh001/_find');
			expect(method).toBe('POST');
			expect(body).toMatchObject({
				selector: { type: 'donation', booking_ref: 'DN-000001' },
				use_index: ['_design/donation-booking-ref', 'donation-booking-ref'],
				allow_fallback: false
			});
			expect(JSON.stringify(body)).not.toContain('$regex');
		});

		it('keeps only received donations', async () => {
			mockCouch({
				find: () => ({ data: { docs: [donation(1, { status: 'declared' }), donation(2)] } })
			});

			expect(ids(await (await search({ by: 'booking_ref', q: 'DN-000002' })).json())).toEqual([
				'donation:w002'
			]);
		});
	});

	describe('phone (AC-6a, FR-8)', () => {
		it.each(['0812345678', '081-234-5678', '+66812345678'])(
			'finds by %j: hash of the normalized number on the phone index',
			async (q) => {
				mockCouch({ find: () => ({ data: { docs: [donation(1)] } }) });

				const data = await (await search({ by: 'phone', q })).json();

				expect(ids(data)).toEqual(['donation:w001']);
				const body = calls('_find')[0][2] as FindBody;
				expect(body.selector['donor.phone_hash']).toBe(sha256('0812345678'));
				expect(body.use_index).toEqual([
					'_design/donation-received-phone',
					'donation-received-phone'
				]);
				expect(body.allow_fallback).toBe(false);
				expect(body.limit).toBe(20);
				expect(JSON.stringify(body)).not.toContain('$regex');
			}
		);

		it('pages by the Mango bookmark carried in the cursor, 20 then the rest', async () => {
			const all = Array.from({ length: 25 }, (_, i) => donation(100 - i));
			mockCouch({
				find: (body) => {
					const start = body.bookmark ? Number(body.bookmark) : 0;
					const docs = all.slice(start, start + 20);
					return { data: { docs, bookmark: String(start + docs.length) } };
				}
			});

			const first = await (await search({ by: 'phone', q: '0812345678' })).json();
			expect(first.donations).toHaveLength(20);
			expect(first.has_more).toBe(true);
			const second = await (
				await search({ by: 'phone', q: '0812345678', cursor: first.cursor })
			).json();
			expect(second.donations).toHaveLength(5);
			expect(second).toMatchObject({ has_more: false, cursor: null });
			expect(new Set([...ids(first), ...ids(second)]).size).toBe(25);
		});

		it('refuses a cursor from another phone number', async () => {
			mockCouch({
				find: () => ({
					data: { docs: Array.from({ length: 20 }, (_, i) => donation(i)), bookmark: 'b' }
				})
			});
			const first = await (await search({ by: 'phone', q: '0812345678' })).json();

			const res = await search({ by: 'phone', q: '0899999999', cursor: first.cursor });

			expect(res.status).toBe(400);
			expect((await res.json()).error_code).toBe('INVALID_CURSOR');
		});
	});

	describe('name / item through the views (AC-6, AC-6e, FR-8h)', () => {
		const viewOf = (view: string, key: string, count: number, at = time(10)) => ({
			rows: {
				[view]: Array.from({ length: count }, (_, i) => ({
					id: `donation:w${String(i).padStart(3, '0')}`,
					key: [key, at]
				}))
			},
			docs: Object.fromEntries(
				Array.from({ length: count }, (_, i) => {
					const d = donation(i, { received_at: at });
					return [d._id, d];
				})
			)
		});

		it.each([
			['name', 'donation_received_by_name', 'สมชาย'],
			['item', 'donation_received_by_item', 'item_master:rice']
		])(
			'25 donations with the same received_at: pages of 20 + 5, none repeated or lost (%s)',
			async (by, view, q) => {
				const { rows, docs } = viewOf(view, q, 25);
				mockCouch({ viewRows: rows, docs });

				const first = await (await search({ by, q })).json();
				expect(first.donations).toHaveLength(20);
				expect(first.has_more).toBe(true);
				expect(typeof first.cursor).toBe('string');

				const second = await (await search({ by, q, cursor: first.cursor })).json();
				expect(second.donations).toHaveLength(5);
				expect(second).toMatchObject({ has_more: false, cursor: null });

				const all = [...ids(first), ...ids(second)];
				expect(new Set(all).size).toBe(25);
				// Same received_at: _id descending.
				expect(all).toEqual(
					Array.from({ length: 25 }, (_, i) => `donation:w${String(24 - i).padStart(3, '0')}`)
				);
			}
		);

		it('reads the view with limit 21 from [q, {}] down to [q] and never uses skip', async () => {
			const { rows, docs } = viewOf('donation_received_by_name', 'สมชาย', 3);
			mockCouch({ viewRows: rows, docs });

			await search({ by: 'name', q: 'สมชาย' });

			const [path, method] = calls('/_view/')[0];
			expect(method).toBe('GET');
			expect(path).toContain('/shelter_sh001/_design/app/_view/donation_received_by_name?');
			const params = new URLSearchParams(String(path).split('?')[1]);
			expect(params.get('limit')).toBe('21');
			expect(params.get('descending')).toBe('true');
			expect(params.get('include_docs')).toBe('true');
			expect(JSON.parse(params.get('startkey')!)).toEqual(['สมชาย', {}]);
			expect(JSON.parse(params.get('endkey')!)).toEqual(['สมชาย']);
			expect(params.has('skip')).toBe(false);
		});

		it('the cursor starts the next page at the 21st row (key + docid)', async () => {
			const { rows, docs } = viewOf('donation_received_by_name', 'สมชาย', 25);
			mockCouch({ viewRows: rows, docs });
			const first = await (await search({ by: 'name', q: 'สมชาย' })).json();

			await search({ by: 'name', q: 'สมชาย', cursor: first.cursor });

			const params = new URLSearchParams(String(calls('/_view/')[1][0]).split('?')[1]);
			expect(JSON.parse(params.get('startkey')!)).toEqual(['สมชาย', time(10)]);
			// 21st row of the descending order is w004.
			expect(params.get('startkey_docid')).toBe('donation:w004');
		});

		it('normalizes the name before the lookup (" สมชาย  ใจดี " → "สมชาย ใจดี")', async () => {
			mockCouch({ viewRows: { donation_received_by_name: [] } });

			await search({ by: 'name', q: ' สมชาย  ใจดี ' });

			const params = new URLSearchParams(String(calls('/_view/')[0][0]).split('?')[1]);
			expect(JSON.parse(params.get('endkey')!)).toEqual(['สมชาย ใจดี']);
		});

		it('AC-6e: a cursor of one search sent with another q or another type is a 400', async () => {
			const { rows, docs } = viewOf('donation_received_by_name', 'สมชาย', 25);
			mockCouch({ viewRows: rows, docs });
			const first = await (await search({ by: 'name', q: 'สมชาย' })).json();

			const otherQ = await search({ by: 'name', q: 'ใจดี', cursor: first.cursor });
			const otherBy = await search({ by: 'item', q: 'สมชาย', cursor: first.cursor });

			expect(otherQ.status).toBe(400);
			expect((await otherQ.json()).error_code).toBe('INVALID_CURSOR');
			expect(otherBy.status).toBe(400);
		});

		it('a hand-made cursor whose key leaves [q, …] is a 400 (no prefix walk past the exact name)', async () => {
			const { rows, docs } = viewOf('donation_received_by_name', 'สมชาย', 25);
			mockCouch({ viewRows: rows, docs });
			const first = await (await search({ by: 'name', q: 'สมชาย' })).json();
			const state = JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8'));
			const forged = Buffer.from(
				JSON.stringify({ ...state, key: ['สมชาย ใจดz', ''] }),
				'utf8'
			).toString('base64url');

			const res = await search({ by: 'name', q: 'สมชาย', cursor: forged });

			expect(res.status).toBe(400);
			expect((await res.json()).error_code).toBe('INVALID_CURSOR');
		});

		it('drops a row whose document is gone or not received', async () => {
			const { rows, docs } = viewOf('donation_received_by_name', 'สมชาย', 3);
			docs['donation:w001'] = { ...docs['donation:w001'], status: 'cancelled' };
			delete docs['donation:w002'];
			mockCouch({ viewRows: rows, docs });

			expect(ids(await (await search({ by: 'name', q: 'สมชาย' })).json())).toEqual([
				'donation:w000'
			]);
		});

		it.each([
			['view version 6 (not yet redeployed)', { designVersion: 6 }],
			['no _design/app', { designVersion: 'missing' as const }],
			['view missing from the design', { viewRows: {} }]
		])('AC-6: 503 DONATION_INDEX_UNAVAILABLE when %s', async (_label, fake) => {
			mockCouch({ viewRows: {}, ...fake } as Fake);

			const res = await search({ by: 'name', q: 'สมชาย' });

			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({ success: false, error: 'DONATION_INDEX_UNAVAILABLE' });
		});
	});

	describe('lot (FR-8d, AC-6d, AC-8)', () => {
		const LOT = 'L-261029-001';
		const ledger = (n: number, donationId: string): Doc => ({
			_id: `stock_ledger:${String(n).padStart(4, '0')}`,
			type: 'stock_ledger',
			reason: 'donation',
			ref_id: donationId,
			lot: { lot_no: LOT }
		});

		it('25 donations, newest first: 20 + 5, none repeated or lost', async () => {
			const donations = Array.from({ length: 25 }, (_, i) =>
				donation(i, { received_at: time(i + 1) })
			);
			const rows = donations.map((d, i) => ledger(i, d._id));
			mockCouch({
				find: () => ({ data: { docs: rows } }),
				docs: Object.fromEntries(donations.map((d) => [d._id, d]))
			});

			const first = await (await search({ by: 'lot', q: LOT })).json();
			expect(first.donations).toHaveLength(20);
			expect(first.has_more).toBe(true);
			expect(ids(first)[0]).toBe('donation:w024');
			const second = await (await search({ by: 'lot', q: LOT, cursor: first.cursor })).json();
			expect(second.donations).toHaveLength(5);
			expect(second).toMatchObject({ has_more: false, cursor: null });

			const all = [...ids(first), ...ids(second)];
			expect(new Set(all).size).toBe(25);
			expect(all).toEqual(donations.map((d) => d._id).reverse());
		});

		it('one donation with 3 ledger rows of the same label shows once', async () => {
			const d = donation(1);
			mockCouch({
				find: () => ({ data: { docs: [ledger(1, d._id), ledger(2, d._id), ledger(3, d._id)] } }),
				docs: { [d._id]: d }
			});

			expect(ids(await (await search({ by: 'lot', q: LOT })).json())).toEqual(['donation:w001']);
		});

		it('two donations with the same received_at across the page boundary: no repeat, none lost', async () => {
			const donations = Array.from({ length: 22 }, (_, i) => donation(i, { received_at: time(7) }));
			mockCouch({
				find: () => ({ data: { docs: donations.map((d, i) => ledger(i, d._id)) } }),
				docs: Object.fromEntries(donations.map((d) => [d._id, d]))
			});

			const first = await (await search({ by: 'lot', q: LOT })).json();
			const second = await (await search({ by: 'lot', q: LOT, cursor: first.cursor })).json();

			expect(first.donations).toHaveLength(20);
			expect(second.donations).toHaveLength(2);
			expect(new Set([...ids(first), ...ids(second)]).size).toBe(22);
		});

		it('a ledger row pointing at a donation of another status is not in the result', async () => {
			const received = donation(1);
			const declared = donation(2, { status: 'declared' });
			mockCouch({
				find: () => ({ data: { docs: [ledger(1, received._id), ledger(2, declared._id)] } }),
				docs: { [received._id]: received, [declared._id]: declared }
			});

			expect(ids(await (await search({ by: 'lot', q: LOT })).json())).toEqual(['donation:w001']);
		});

		it('two donations that share the label are both listed (lot_no is not unique)', async () => {
			const a = donation(1);
			const b = donation(2);
			mockCouch({
				find: () => ({ data: { docs: [ledger(1, a._id), ledger(2, b._id)] } }),
				docs: { [a._id]: a, [b._id]: b }
			});

			expect(ids(await (await search({ by: 'lot', q: LOT })).json()).sort()).toEqual([
				'donation:w001',
				'donation:w002'
			]);
		});

		it('follows the bookmark in rounds of 200 until a round is short (no default limit of 25)', async () => {
			const donations = Array.from({ length: 450 }, (_, i) =>
				donation(i, { received_at: time(1 + (i % 28)) })
			);
			const rows = donations.map((d, i) => ledger(i, d._id));
			mockCouch({
				find: (body) => {
					const start = body.bookmark ? Number(body.bookmark) : 0;
					const docs = rows.slice(start, start + body.limit);
					return { data: { docs, bookmark: String(start + docs.length) } };
				},
				docs: Object.fromEntries(donations.map((d) => [d._id, d]))
			});

			const first = await (await search({ by: 'lot', q: LOT })).json();

			const finds = calls('_find');
			expect(finds.map((c) => (c[2] as { limit: number }).limit)).toEqual([200, 200, 200]);
			expect((finds[0][2] as FindBody).selector).toEqual({
				type: 'stock_ledger',
				'lot.lot_no': LOT,
				reason: 'donation'
			});
			expect((finds[0][2] as FindBody).use_index).toEqual([
				'_design/stock-ledger-lot-no',
				'stock-ledger-lot-no'
			]);
			expect(first.donations).toHaveLength(20);
			expect(first.has_more).toBe(true);
			// Fetched by id from _all_docs, not scanned.
			expect(calls('_all_docs').length).toBeGreaterThan(0);
		});

		it('upper-cases the lot number before the lookup', async () => {
			mockCouch({ find: () => ({ data: { docs: [] } }) });

			await search({ by: 'lot', q: ' l-261029-001 ' });

			expect((calls('_find')[0][2] as FindBody).selector['lot.lot_no']).toBe(LOT);
		});
	});

	describe('missing index (AC-6)', () => {
		it.each(['booking_ref', 'phone', 'lot'] as const)(
			'503 DONATION_INDEX_UNAVAILABLE for %s when the index is not deployed',
			async (by) => {
				mockCouch({ find: () => ({ status: 400, data: { error: 'no_usable_index' } }) });
				const q = by === 'phone' ? '0812345678' : by === 'lot' ? 'L-261029-001' : 'DN-000001';

				const res = await search({ by, q });

				expect(res.status).toBe(503);
				expect(await res.json()).toEqual({ success: false, error: 'DONATION_INDEX_UNAVAILABLE' });
				expect(calls('_find')).toHaveLength(1);
			}
		);

		it('another CouchDB failure is a 502, not a missing index', async () => {
			mockCouch({ find: () => ({ status: 500, data: { error: 'boom' } }) });

			expect((await search({ by: 'phone', q: '0812345678' })).status).toBe(502);
		});
	});

	describe('masked rows (FR-10, AC-5a, AC-6a, FR-10c, AC-6c)', () => {
		it('never returns the full name, phone, email, or any hash', async () => {
			mockCouch({ find: () => ({ data: { docs: [donation(1)] } }) });

			const res = await search({ by: 'phone', q: '081-234-5678' });
			const text = JSON.stringify(await res.json());

			expect(text).not.toContain('ใจดี');
			expect(text).not.toContain('0812345678');
			expect(text).not.toContain('somchai@example.com');
			expect(text).not.toContain('secret');
			expect(text).not.toContain(sha256('0812345678'));
			expect(text).toContain('สมชาย ใ****');
			expect(text).toContain('xxx-xxx-5678');
			expect(text).toContain('s***i@example.com');
			expect(text).toContain('"contact_masked":true');
		});

		it('a donation whose contact is gone is found by phone and listed as ไม่ระบุชื่อ', async () => {
			mockCouch({
				find: () => ({
					data: { docs: [donation(1, { donor: { phone_hash: sha256('0812345678') } })] }
				})
			});

			const data = await (await search({ by: 'phone', q: '0812345678' })).json();

			expect(data.donations[0]).toMatchObject({
				donor_name: 'ไม่ระบุชื่อ',
				donor_phone: null,
				donor_email: null
			});
		});

		it('a free_text-only donation is not in an item search but is in a name search (AC-6c)', async () => {
			const d = donation(1, { items: [{ free_text: 'น้ำดื่ม', qty: '1', unit: 'ลัง' }] });
			mockCouch({
				// The item view has no row for it; the name view does.
				viewRows: {
					donation_received_by_item: [],
					donation_received_by_name: [{ id: d._id, key: ['สมชาย', time(10)] }]
				},
				docs: { [d._id]: d }
			});

			expect(
				(await (await search({ by: 'item', q: 'item_master:rice' })).json()).donations
			).toEqual([]);
			expect(ids(await (await search({ by: 'name', q: 'สมชาย' })).json())).toEqual([
				'donation:w001'
			]);
		});
	});

	describe('log (FR-8f, AC-6b)', () => {
		it('writes one donation_received_search event with who, where, type, count and time — no q', async () => {
			mockCouch({ find: () => ({ data: { docs: [donation(1)] } }) });

			await search({ by: 'phone', q: '081-234-5678' });

			expect(info).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(String(info.mock.calls[0][0]));
			expect(Object.keys(payload).sort()).toEqual(
				['at', 'by', 'event', 'result_count', 'shelter_code', 'user'].sort()
			);
			expect(payload).toMatchObject({
				event: 'donation_received_search',
				user: 'warehouse01',
				shelter_code: 'SH001',
				by: 'phone',
				result_count: 1
			});
			expect(Number.isNaN(Date.parse(payload.at))).toBe(false);
		});

		it('never logs the term, a name, a number or a cursor', async () => {
			const docs = Array.from({ length: 20 }, (_, i) => donation(i));
			mockCouch({ find: () => ({ data: { docs, bookmark: 'bm-secret' } }) });

			const first = await (await search({ by: 'phone', q: '081-234-5678' })).json();
			await search({ by: 'phone', q: '081-234-5678', cursor: first.cursor });

			const logged = info.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
			expect(logged).not.toContain('5678');
			expect(logged).not.toContain('081');
			expect(logged).not.toContain('สมชาย');
			expect(logged).not.toContain(String(first.cursor));
			expect(logged).not.toContain('bm-secret');
			expect(info).toHaveBeenCalledTimes(2);
		});

		it('logs a search that found nothing, with result_count 0', async () => {
			mockCouch({ viewRows: { donation_received_by_name: [] } });

			await search({ by: 'name', q: 'ไม่มีชื่อนี้' });

			expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ result_count: 0 });
			expect(String(info.mock.calls[0][0])).not.toContain('ไม่มีชื่อนี้');
		});

		it('does not log a search that was refused', async () => {
			mockCouch({});

			await search({ by: 'phone', q: '5678' });

			expect(info).not.toHaveBeenCalled();
		});
	});
});
