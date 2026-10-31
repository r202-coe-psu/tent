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

	it('carries the donor photos of a booking, and an empty list when it has none (FR-12)', async () => {
		const photos = ['image:01K8PHXTX00000000000000001', 'image:01K8PHXTX00000000000000002'];
		const withPhotos = { doc: { ...sh001[0].doc, photos } };
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) =>
			Promise.resolve(
				method === 'GET' && path.includes('/shelter_sh001/')
					? { status: 200, data: { rows: [withPhotos, sh001[1]] } }
					: { status: 404, data: {} }
			)
		);

		const data = await (await GET(event())).json();
		const byRef = Object.fromEntries(
			data.donations.map((d: { booking_ref: string; photos: string[] }) => [
				d.booking_ref,
				d.photos
			])
		);

		expect(byRef['DN-000002']).toEqual(photos);
		expect(byRef['DN-000001']).toEqual([]);
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

	it('maps logistics.vehicle_plate: v10 doc → value, older doc → null', async () => {
		const v10 = {
			...sh001[0]!.doc,
			_id: 'donation:v10',
			booking_ref: 'DN-000010',
			schema_v: 10,
			logistics: {
				delivery_method: 'self_dropoff',
				vehicle: 'car',
				vehicle_plate: 'กข 1234 กรุงเทพมหานคร',
				eta: '2026-07-21T09:00:00.000Z'
			}
		};
		const v7 = { ...sh001[1]!.doc, schema_v: 7 };
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
				});
			}
			if (method === 'GET' && path.includes('/shelter_sh001/')) {
				return Promise.resolve({ status: 200, data: { rows: [{ doc: v10 }, { doc: v7 }] } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const data = await (await GET(event())).json();
		const byRef = Object.fromEntries(
			data.donations.map((d: { booking_ref: string; vehicle_plate: string | null }) => [
				d.booking_ref,
				d.vehicle_plate
			])
		);
		expect(byRef['DN-000010']).toBe('กข 1234 กรุงเทพมหานคร');
		expect(byRef['DN-000001']).toBeNull();
		// the existing columns are untouched
		expect(data.donations[0]).toMatchObject({ vehicle: 'car', delivery_method: 'self_dropoff' });
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

	it('E3: lists a walk-in received donation with the donor contact MASKED (FR-10)', async () => {
		mockFind({ data: { docs: [walkIn(1)], bookmark: 'b' } });

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations).toHaveLength(1);
		expect(data.donations[0]).toMatchObject({
			status: 'received',
			donor_name: 'ผู้บริจาค 1****',
			donor_phone: 'xxx-xxx-1111',
			donor_email: 'a***@b.th',
			contact_masked: true,
			received_at: '2026-10-02T00:00:00.000Z'
		});
		expect(JSON.stringify(data)).not.toContain('secret');
	});

	it('E3c: "รายการที่รับ" carries what was received — counted qty, turned-away lines left out (FR-4)', async () => {
		mockFind({
			data: {
				docs: [
					walkIn(1, {
						items: [
							{ item_id: 'item_master:rice', qty: '10', unit: 'kg' },
							{ item_id: 'item_master:milk', qty: '5', unit: 'box' }
						],
						received_summary: {
							total_items: 2,
							received_at: '2026-10-02T00:00:00.000Z',
							items: [
								{ item_id: 'item_master:rice', qty: '6', unit: 'kg' },
								{ item_id: 'item_master:milk', qty: '0', rejected: true }
							]
						}
					}),
					walkIn(2, { items: [{ item_id: 'item_master:rice', qty: '3', unit: 'kg' }] })
				]
			}
		});

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations[0].received_items).toEqual([
			{ item_id: 'item_master:rice', qty: '6', unit: 'kg' }
		]);
		// A donation received before received_summary.items existed has none; the list falls back.
		expect(data.donations[1].received_items).toBeUndefined();
	});

	it('E3b: a walk-in with no phone or email does not crash', async () => {
		mockFind({ data: { docs: [walkIn(1, { donor: { name: 'ก' } })] } });

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations[0]).toMatchObject({ donor_phone: null, donor_email: null });
	});

	it('FR-10 / AC-5a: no full name, phone or email anywhere in the response', async () => {
		mockFind({
			data: {
				docs: [
					walkIn(1, {
						donor: {
							name: 'สมชาย ใจดี',
							phone: '0812345678',
							phone_hash: 'ph-secret',
							email: 'somchai@example.com'
						}
					})
				]
			}
		});

		const text = JSON.stringify(await (await GET(event('?status=received'))).json());

		expect(text).not.toContain('ใจดี');
		expect(text).not.toContain('0812345678');
		expect(text).not.toContain('somchai@example.com');
		expect(text).toContain('สมชาย ใ****');
		expect(text).toContain('xxx-xxx-5678');
		expect(text).toContain('s***i@example.com');
	});

	it('FR-10c: a donation whose contact was removed lists as ไม่ระบุชื่อ with null phone / email', async () => {
		mockFind({ data: { docs: [walkIn(1, { donor: { phone_hash: 'ph-secret' } })] } });

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations[0]).toMatchObject({
			donor_name: 'ไม่ระบุชื่อ',
			donor_phone: null,
			donor_email: null,
			contact_masked: true
		});
	});

	it('FR-7: the review queue keeps the full contact and is not marked masked', async () => {
		mockCouch();

		const data = await (await GET(event('?status=declared'))).json();

		expect(data.donations[0]).toMatchObject({
			donor_name: 'ผู้บริจาค ก',
			donor_phone: '0800000001'
		});
		expect(data.donations[0]).not.toHaveProperty('contact_masked');
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

	it('E6b2: exactly 20 received donations: no "โหลดเพิ่ม" (one-row probe past the bookmark is empty)', async () => {
		mockFind(
			{ data: { docs: Array.from({ length: 20 }, (_, i) => walkIn(i)), bookmark: 'b1' } },
			{ data: { docs: [], bookmark: 'b1' } }
		);

		const first = await (await GET(event('?status=received'))).json();

		expect(first).toMatchObject({ has_more: false, bookmark: null });
		const probe = vi.mocked(adminRaw).mock.calls[1][2] as { bookmark?: string; limit?: number };
		expect(probe).toMatchObject({ bookmark: 'b1', limit: 1 });
	});

	it('E6b3: a full page with a row after it offers the next page', async () => {
		mockFind(
			{ data: { docs: Array.from({ length: 20 }, (_, i) => walkIn(i)), bookmark: 'b1' } },
			{ data: { docs: [walkIn(20)], bookmark: 'b2' } }
		);

		const first = await (await GET(event('?status=received'))).json();

		expect(first).toMatchObject({ has_more: true, bookmark: 'b1' });
		expect(first.donations).toHaveLength(20);
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

	it('FR-9a: a system admin must say which shelter (400 without), and reads only that one', async () => {
		asSA();

		expect((await GET(event('?status=received'))).status).toBe(400);
		expect(findCalls()).toHaveLength(0);

		expect((await GET(event('?status=received&shelter=SH002'))).status).toBe(200);
		expect(findCalls()).toHaveLength(1);
		expect(findCalls()[0][0]).toBe('/shelter_sh002/_find');
	});

	it('AC-5c: FR-9a is for status=received only — a system admin reads every shelter for another status', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockCouch();

		const response = await GET(event('?status=declared'));

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.donations.map((d: { shelter_code: string }) => d.shelter_code).sort()).toEqual([
			'SH001',
			'SH001',
			'SH002'
		]);
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
