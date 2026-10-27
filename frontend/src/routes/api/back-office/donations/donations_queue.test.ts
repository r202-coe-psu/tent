import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const sh001 = [
	{
		doc: {
			_id: 'donation:a',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH001',
			booking_ref: 'DN-000002',
			donor: { name: 'ผู้บริจาค ข', phone: '0800000002' },
			items: [{ free_text: 'น้ำดื่ม', qty: '5', unit: 'ลัง' }],
			tracking_token_hash: 'hash-a',
			logistics: { delivery_method: 'self_dropoff', eta: '2026-07-23T09:00:00.000Z' }
		}
	},
	{
		doc: {
			_id: 'donation:b',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH001',
			booking_ref: 'DN-000001',
			donor: { name: 'ผู้บริจาค ก', phone: '0800000001' },
			items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
			tracking_token_hash: 'hash-b',
			logistics: { delivery_method: 'self_dropoff', eta: '2026-07-22T09:00:00.000Z' }
		}
	},
	{
		doc: {
			_id: 'donation:c',
			type: 'donation',
			status: 'received',
			shelter_code: 'SH001',
			booking_ref: 'DN-000003',
			donor: { name: 'ผู้บริจาค ค', phone: '0800000003' },
			items: [],
			tracking_token_hash: 'hash-c'
		}
	}
];

const sh002 = [
	{
		doc: {
			_id: 'donation:d',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH002',
			booking_ref: 'DN-000004',
			donor: { name: 'ศูนย์อื่น', phone: '0800000004' },
			items: [],
			tracking_token_hash: 'hash-d'
		}
	}
];

function mockCouch() {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: {
					rows: [
						{ id: 'shelter:SH001', doc: { code: 'SH001' } },
						{ id: 'shelter:SH002', doc: { code: 'SH002' } }
					]
				}
			});
		}
		if (method === 'GET' && path.includes('/shelter_sh001/')) {
			return Promise.resolve({ status: 200, data: { rows: sh001 } });
		}
		if (method === 'GET' && path.includes('/shelter_sh002/')) {
			return Promise.resolve({ status: 200, data: { rows: sh002 } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

const event = (search = '') =>
	({
		url: new URL(`http://localhost/api/back-office/donations${search}`),
		request: { headers: { get: () => 'session-cookie' } }
	}) as unknown as GetEvent;

describe('GET /api/back-office/donations (pending intake queue)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('lists only declared donations of the caller shelter, soonest ETA first', async () => {
		mockCouch();

		const response = await GET(event());
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.donations.map((d: { booking_ref: string }) => d.booking_ref)).toEqual([
			'DN-000001',
			'DN-000002'
		]);
		expect(data.donations[0]).toMatchObject({ donor_name: 'ผู้บริจาค ก', item_count: 1 });
	});

	it('never exposes the tracking token hash', async () => {
		mockCouch();

		const data = await (await GET(event())).json();

		expect(JSON.stringify(data)).not.toContain('hash-');
	});

	it('does not read other shelters for a scoped caller', async () => {
		mockCouch();

		const data = await (await GET(event())).json();

		expect(JSON.stringify(data)).not.toContain('ศูนย์อื่น');
		const readOther = vi
			.mocked(adminRaw)
			.mock.calls.some((c) => String(c[0]).includes('/shelter_sh002/'));
		expect(readOther).toBe(false);
	});

	it('lets a system admin see every shelter', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockCouch();

		const data = await (await GET(event())).json();

		expect(data.donations).toHaveLength(3);
	});

	it('still reads pending/awaiting statuses through the _all_docs scan, never _find (E8b)', async () => {
		mockCouch();

		await GET(event('?status=declared'));

		const paths = vi.mocked(adminRaw).mock.calls.map((c) => String(c[0]));
		expect(paths.some((p) => p.includes('_all_docs'))).toBe(true);
		expect(paths.some((p) => p.includes('_find'))).toBe(false);
	});

	it('returns 403 for a signed-in user without a warehouse capability', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'reg',
			roles: ['shelter:SH001', 'registration_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockCouch();

		const response = await GET(event());

		expect(response.status).toBe(403);
	});
});

describe('GET /api/back-office/donations?status=received (#821)', () => {
	const walkIn = (n: number, over: Record<string, unknown> = {}) => ({
		_id: `donation:w${String(n).padStart(3, '0')}`,
		type: 'donation',
		status: 'received',
		channel: 'walk_in',
		shelter_code: 'SH001',
		donor: {
			name: `ผู้บริจาค ${n}`,
			phone: '0811111111',
			phone_hash: 'ph-secret',
			email: 'a@b.th'
		},
		items: [],
		tracking_token_hash: 'th-secret',
		received_at: `2026-10-0${(n % 9) + 1}T00:00:00.000Z`,
		...over
	});
	const findCalls = () =>
		vi.mocked(adminRaw).mock.calls.filter((c) => String(c[0]).includes('_find'));
	const mockFind = (...pages: Array<{ status?: number; data: unknown }>) => {
		let i = 0;
		vi.mocked(adminRaw).mockImplementation(() => {
			const page = pages[Math.min(i++, pages.length - 1)];
			return Promise.resolve({ status: page.status ?? 200, data: page.data });
		});
	};

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('E3: lists a walk-in received donation with donor name, phone and email, redacted', async () => {
		mockFind({ data: { docs: [walkIn(1)], bookmark: 'b' } });

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations).toHaveLength(1);
		expect(data.donations[0]).toMatchObject({
			status: 'received',
			donor_name: 'ผู้บริจาค 1',
			donor_phone: '0811111111',
			donor_email: 'a@b.th',
			received_at: '2026-10-02T00:00:00.000Z'
		});
		expect(JSON.stringify(data)).not.toContain('secret');
	});

	it('E3b: a walk-in with no phone or email does not crash', async () => {
		mockFind({ data: { docs: [walkIn(1, { donor: { name: 'ก' } })] } });

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations[0]).toMatchObject({ donor_phone: null, donor_email: null });
	});

	it('E6: sends a bounded index-pinned _find with no _all_docs scan', async () => {
		mockFind({ data: { docs: [] } });

		await GET(event('?status=received&limit=500'));

		expect(findCalls()).toHaveLength(1);
		const [path, method, body] = findCalls()[0];
		expect(path).toBe('/shelter_sh001/_find');
		expect(method).toBe('POST');
		expect(body).toEqual({
			selector: { type: 'donation', status: 'received' },
			sort: [{ type: 'desc' }, { status: 'desc' }, { received_at: 'desc' }, { _id: 'desc' }],
			use_index: ['_design/donation-received-list', 'donation-received-by-received-at'],
			allow_fallback: false,
			limit: 20
		});
		expect(body).not.toHaveProperty('bookmark');
		expect(body).not.toHaveProperty('skip');
		expect(vi.mocked(adminRaw).mock.calls.some((c) => String(c[0]).includes('_all_docs'))).toBe(
			false
		);
	});

	it('E6a: passes the bookmark through as the cursor', async () => {
		mockFind({ data: { docs: [] } });

		await GET(event('?status=received&bookmark=b1'));

		expect(findCalls()[0][2]).toMatchObject({ bookmark: 'b1' });
	});

	it('E6b: a short page is the end, whatever the bookmark says', async () => {
		mockFind({ data: { docs: Array.from({ length: 7 }, (_, i) => walkIn(i)), bookmark: 'more?' } });

		const data = await (await GET(event('?status=received'))).json();

		expect(data).toMatchObject({ has_more: false, bookmark: null });
		expect(data.donations).toHaveLength(7);
	});

	it('E6b2: a full page offers the next one; an empty page after it is handled', async () => {
		mockFind(
			{ data: { docs: Array.from({ length: 20 }, (_, i) => walkIn(i)), bookmark: 'b1' } },
			{ data: { docs: [], bookmark: 'b1' } }
		);

		const first = await (await GET(event('?status=received'))).json();
		const second = await (await GET(event('?status=received&bookmark=b1'))).json();

		expect(first).toMatchObject({ has_more: true, bookmark: 'b1' });
		expect(second).toMatchObject({ success: true, donations: [], has_more: false, bookmark: null });
	});

	it('E6c: following bookmarks over a stable dataset yields no duplicates or skips', async () => {
		const all = Array.from({ length: 45 }, (_, i) => walkIn(100 + i));
		vi.mocked(adminRaw).mockImplementation((_path, _method, body) => {
			const bm = (body as { bookmark?: string }).bookmark;
			const start = bm ? Number(bm) : 0;
			const docs = all.slice(start, start + 20);
			return Promise.resolve({
				status: 200,
				data: { docs, bookmark: String(start + docs.length) }
			});
		});

		const ids: string[] = [];
		let bookmark: string | null = null;
		for (let guard = 0; guard < 10; guard++) {
			const data = await (
				await GET(event(`?status=received${bookmark ? `&bookmark=${bookmark}` : ''}`))
			).json();
			ids.push(...data.donations.map((d: { donation_id: string }) => d.donation_id));
			if (!data.has_more) break;
			bookmark = data.bookmark;
		}

		expect(ids).toEqual(all.map((d) => d._id));
		expect(new Set(ids).size).toBe(45);
	});

	it('E6e: keeps CouchDB order and breaks received_at ties on _id (sort carries _id)', async () => {
		const same = '2026-10-05T00:00:00.000Z';
		mockFind({
			data: {
				docs: [walkIn(3, { received_at: same }), walkIn(2, { received_at: same }), walkIn(1)]
			}
		});

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations.map((d: { donation_id: string }) => d.donation_id)).toEqual([
			'donation:w003',
			'donation:w002',
			'donation:w001'
		]);
		expect((findCalls()[0][2] as { sort: unknown[] }).sort.at(-1)).toEqual({ _id: 'desc' });
	});

	it('E6g: a database without the index answers 503 DONATION_INDEX_UNAVAILABLE, no scan', async () => {
		mockFind({ status: 400, data: { error: 'no_usable_index', reason: 'x' } });

		const response = await GET(event('?status=received'));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ success: false, error: 'DONATION_INDEX_UNAVAILABLE' });
		expect(vi.mocked(adminRaw)).toHaveBeenCalledTimes(1);
	});

	it('E6g2: other CouchDB failures are not reported as a missing index', async () => {
		mockFind({ status: 500, data: { error: 'boom' } });

		expect((await GET(event('?status=received'))).status).toBe(502);
	});

	it('E5: 403 for a user without a warehouse capability, and no _find', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'reg',
			roles: ['shelter:SH001', 'registration_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockFind({ data: { docs: [] } });

		expect((await GET(event('?status=received'))).status).toBe(403);
		expect(findCalls()).toHaveLength(0);
	});

	it('E5c: a scoped caller naming another shelter gets 403 and no _find', async () => {
		mockFind({ data: { docs: [] } });

		const response = await GET(event('?status=received&shelter=SH002'));

		expect(response.status).toBe(403);
		expect(findCalls()).toHaveLength(0);
	});

	it('a scoped caller naming their own shelter is fine', async () => {
		mockFind({ data: { docs: [] } });

		const response = await GET(event('?status=received&shelter=SH001'));

		expect(response.status).toBe(200);
		expect(findCalls()[0][0]).toBe('/shelter_sh001/_find');
	});

	const asSA = () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockImplementation((path: string) =>
			Promise.resolve(
				path.includes('/registry/')
					? {
							status: 200,
							data: {
								rows: [
									{ id: 'shelter:SH001', doc: { code: 'SH001' } },
									{ id: 'shelter:SH002', doc: { code: 'SH002' } }
								]
							}
						}
					: { status: 200, data: { docs: [] } }
			)
		);
	};

	it('A1: a system admin must say which shelter (400 without), and reads only that one', async () => {
		asSA();

		expect((await GET(event('?status=received'))).status).toBe(400);
		expect(findCalls()).toHaveLength(0);

		expect((await GET(event('?status=received&shelter=SH002'))).status).toBe(200);
		expect(findCalls()).toHaveLength(1);
		expect(findCalls()[0][0]).toBe('/shelter_sh002/_find');
	});

	it.each(['x/../../_users', 'SH999', '..%2F_users'])(
		'a system admin naming an unregistered shelter %j gets 404 and no _find',
		async (shelter) => {
			asSA();

			const response = await GET(event(`?status=received&shelter=${encodeURIComponent(shelter)}`));

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ success: false, error: 'Unknown shelter' });
			expect(findCalls()).toHaveLength(0);
		}
	);

	it.each([
		['too long', 'x'.repeat(1025)],
		['empty', '']
	])('E9c: a %s bookmark is a 400', async (_label, bookmark) => {
		mockFind({ data: { docs: [] } });

		const response = await GET(event(`?status=received&bookmark=${bookmark}`));

		expect(response.status).toBe(400);
		expect(findCalls()).toHaveLength(0);
	});

	it.each(['pending_review', 'verifying', 'declared'])('E9: allows status %s', async (status) => {
		mockCouch();

		expect((await GET(event(`?status=${status}`))).status).toBe(200);
	});

	it.each([
		'rejected',
		'cancelled',
		'expired',
		'redirected',
		'',
		'foo',
		'RECEIVED',
		'declared,received'
	])('E9b: rejects status %j with 400 and reads nothing', async (status) => {
		mockCouch();

		const response = await GET(event(`?status=${encodeURIComponent(status)}`));

		expect(response.status).toBe(400);
		expect(vi.mocked(adminRaw)).not.toHaveBeenCalled();
	});
});
