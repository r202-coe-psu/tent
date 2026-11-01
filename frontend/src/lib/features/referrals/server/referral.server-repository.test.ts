import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CouchDbReferralServerRepository } from './referral.server-repository';
import type { Referral } from '../domain/referral.schema';
import type { Evacuee } from '$lib/features/people/domain/people';

const adminRaw = vi.fn();

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: (...args: unknown[]) => adminRaw(...args)
}));

function activeEvacuee(overrides: Partial<Evacuee> = {}): Evacuee {
	return {
		_id: 'evacuee:01F8MECHEVACUEEID1234567',
		_rev: '1-abc',
		type: 'evacuee',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-07-11T05:00:00.000Z',
		updated_at: '2026-07-11T05:00:00.000Z',
		created_by: 'Staff A',
		first_name: 'John',
		last_name: 'Doe',
		gender: 'male',
		phone: '0812345678',
		country: 'THAILAND',
		special_needs: [],
		household_id: null,
		current_stay: { status: 'active', zone: 'A', since: '2026-07-11T05:00:00.000Z' },
		privacy: { search_excluded: false },
		registered_via: 'app',
		...overrides
	} as Evacuee;
}

const capacitySent: Referral = {
	_id: 'referral:01CAPACITY',
	_rev: '1-ref',
	type: 'referral',
	schema_v: 1,
	shelter_code: 'SH001',
	created_at: '2026-07-11T05:00:00.000Z',
	updated_at: '2026-07-11T05:00:00.000Z',
	created_by: 'Staff A',
	evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
	referral_type: 'capacity',
	to_shelter_code: 'SH002',
	reason: 'Full',
	urgency: 'normal',
	status: 'sent',
	timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } }
};

describe('CouchDbReferralServerRepository capacity destination-gated accept', () => {
	let repo: CouchDbReferralServerRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new CouchDbReferralServerRepository('central_ops', 'SH002');
	});

	it('writes dest intake then source transfer_out without rewriting source shelter_code', async () => {
		const evacuee = activeEvacuee();
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: evacuee };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'GET' && decoded.includes('/movement:capacity_')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				return { status: 201, data: { ok: true, id: 'x', rev: '2-new' } };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z', 'ok');

		const putCalls = adminRaw.mock.calls.filter((c) => c[1] === 'PUT');
		expect(putCalls.length).toBe(4);

		const destEvacueePut = putCalls.find((c) =>
			decodeURIComponent(String(c[0])).startsWith('/shelter_sh002/evacuee:')
		);
		const sourceEvacueePut = putCalls.find((c) =>
			decodeURIComponent(String(c[0])).startsWith('/shelter_sh001/evacuee:')
		);
		const destMovementPut = putCalls.find(
			(c) => (c[2] as { _id?: string })?._id === 'movement:capacity_transfer_in:01CAPACITY'
		);
		expect(destMovementPut).toBeTruthy();
		expect(destEvacueePut?.[2]).toEqual(
			expect.objectContaining({
				shelter_code: 'SH002',
				current_stay: expect.objectContaining({ status: 'active' })
			})
		);
		expect(sourceEvacueePut?.[2]).toEqual(
			expect.objectContaining({
				shelter_code: 'SH001',
				current_stay: expect.objectContaining({ status: 'transferred' })
			})
		);
	});

	it('skips duplicate dest write when dest already active and only finishes source', async () => {
		const evacuee = activeEvacuee();
		const destActive = activeEvacuee({
			shelter_code: 'SH002',
			_rev: '2-dest'
		});
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: evacuee };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 200, data: destActive };
			}
			if (method === 'GET' && decoded.includes('/movement:capacity_transfer_out:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				return { status: 201, data: { ok: true, id: 'x', rev: '3-new' } };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z');

		const putCalls = adminRaw.mock.calls.filter((c) => c[1] === 'PUT');
		expect(putCalls.length).toBe(2); // source movement + source evacuee only
		expect(
			putCalls.every((c) => decodeURIComponent(String(c[0])).startsWith('/shelter_sh001/'))
		).toBe(true);
		expect(putCalls[0]?.[2]).toEqual(
			expect.objectContaining({
				_id: 'movement:capacity_transfer_out:01CAPACITY',
				action: 'transfer_out'
			})
		);
	});

	it('no-ops when source already transferred and dest already active', async () => {
		const transferred = activeEvacuee({
			current_stay: { status: 'transferred', zone: null, since: '2026-07-24T03:00:00.000Z' }
		});
		const destActive = activeEvacuee({ shelter_code: 'SH002', _rev: '2-dest' });
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: transferred };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 200, data: destActive };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z');
		expect(adminRaw.mock.calls.every((c) => c[1] !== 'PUT')).toBe(true);
	});

	it('repairs dest when source transferred but dest missing', async () => {
		const transferred = activeEvacuee({
			current_stay: { status: 'transferred', zone: null, since: '2026-07-24T03:00:00.000Z' }
		});
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: transferred };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'GET' && decoded.includes('/movement:capacity_transfer_in:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				return { status: 201, data: { ok: true, id: 'x', rev: '2-new' } };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z');

		const putCalls = adminRaw.mock.calls.filter((c) => c[1] === 'PUT');
		expect(putCalls.length).toBe(2);
		expect(
			putCalls.every((c) => decodeURIComponent(String(c[0])).startsWith('/shelter_sh002/'))
		).toBe(true);
		expect(
			putCalls.some((c) => (c[2] as { _id: string })._id.includes('capacity_transfer_in'))
		).toBe(true);
	});

	it('rejects capacity accept when actor is source shelter (403)', async () => {
		const sourceRepo = new CouchDbReferralServerRepository('central_ops', 'SH001');
		adminRaw.mockImplementation(async (path: string, method: string) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('referral:01CAPACITY')) {
				return { status: 200, data: capacitySent };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});

		await expect(
			sourceRepo.transition('referral:01CAPACITY', 'accepted', 'Staff A', 'nope', 'SH001')
		).rejects.toMatchObject({
			status: 403,
			message: expect.stringMatching(/destination shelter/i)
		});
	});

	it('fail-fast when source evacuee missing', async () => {
		adminRaw.mockResolvedValue({ status: 404, data: { error: 'not_found' } });

		await expect(
			repo.completeCapacityTransfer(capacitySent, 'Staff B', '2026-07-24T04:00:00.000Z')
		).rejects.toThrow(/not found/);

		expect(adminRaw.mock.calls.every((c) => c[1] !== 'PUT')).toBe(true);
	});
});

describe('CouchDbReferralServerRepository transition() checks the state matrix before capacity transfer', () => {
	const capacityRejected: Referral = { ...capacitySent, status: 'rejected' };
	const capacityAccepted: Referral = { ...capacitySent, status: 'accepted' };
	let repo: CouchDbReferralServerRepository;

	/** Document writes only: excludes the one-time `PUT /central_ops` DB create (no body). */
	function putCalls() {
		return adminRaw.mock.calls.filter((c) => c[1] === 'PUT' && c[2] !== undefined);
	}

	/**
	 * Stateless fake of central_ops + shelter DBs. `referral` is read per GET so a test can
	 * change the latest referral between attempts. `referralPutStatus` drives the referral write.
	 */
	function mockDb(referral: () => Referral, referralPutStatus: () => number = () => 201) {
		adminRaw.mockImplementation(async (path: string, method: string, body?: unknown) => {
			const decoded = decodeURIComponent(path);
			if (method === 'GET' && decoded.includes('referral:01CAPACITY')) {
				return { status: 200, data: referral() };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh001/evacuee:')) {
				return { status: 200, data: activeEvacuee() };
			}
			if (method === 'GET' && decoded.includes('/shelter_sh002/evacuee:')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'GET' && decoded.includes('/movement:capacity_')) {
				return { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				const id = (body as { _id?: string } | undefined)?._id;
				const status = id === 'referral:01CAPACITY' ? referralPutStatus() : 201;
				return { status, data: { ok: true, id, rev: '2-new' } };
			}
			return { status: 500, data: { error: 'unexpected', path, method } };
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new CouchDbReferralServerRepository('central_ops', 'SH002');
	});

	it('accept on a rejected referral → 422 with no shelter reads and no transfer writes', async () => {
		mockDb(() => capacityRejected);

		await expect(
			repo.transition('referral:01CAPACITY', 'accepted', 'Staff B', 'late', 'SH002')
		).rejects.toMatchObject({ status: 422, message: 'Invalid referral transition' });

		expect(putCalls()).toHaveLength(0);
		expect(
			adminRaw.mock.calls.some((c) => decodeURIComponent(String(c[0])).includes('/shelter_'))
		).toBe(false);
	});

	it('accept on an already accepted referral → 422 and no second transfer', async () => {
		mockDb(() => capacityAccepted);

		await expect(
			repo.transition('referral:01CAPACITY', 'accepted', 'Staff B', 'again', 'SH002')
		).rejects.toMatchObject({ status: 422, message: 'Invalid referral transition' });

		expect(putCalls()).toHaveLength(0);
		expect(
			adminRaw.mock.calls.some((c) => decodeURIComponent(String(c[0])).includes('/shelter_'))
		).toBe(false);
	});

	it('accept on a sent referral still transfers the evacuee and marks it accepted', async () => {
		mockDb(() => capacitySent);

		const result = await repo.transition(
			'referral:01CAPACITY',
			'accepted',
			'Staff B',
			'ok',
			'SH002'
		);

		expect(result.status).toBe('accepted');
		const puts = putCalls();
		expect(
			puts.some(
				(c) => (c[2] as { _id?: string })._id === 'movement:capacity_transfer_in:01CAPACITY'
			)
		).toBe(true);
		expect(
			puts.some(
				(c) =>
					(c[2] as { _id?: string; status?: string })._id === 'referral:01CAPACITY' &&
					(c[2] as { status?: string }).status === 'accepted'
			)
		).toBe(true);
	});

	it('source withdraws a sent referral: closed, timeline.sent kept, no transfer writes', async () => {
		mockDb(() => capacitySent);
		repo = new CouchDbReferralServerRepository('central_ops', 'SH001');

		const result = await repo.transition(
			'referral:01CAPACITY',
			'closed',
			'Staff A',
			'ส่งผิด',
			'SH001'
		);

		expect(result.status).toBe('closed');
		expect(result.timeline.sent).toEqual(capacitySent.timeline.sent);
		expect(result.timeline.closed?.by).toBe('Staff A');
		expect(result.close_reason).toBe('ส่งผิด');
		expect(putCalls().map((c) => (c[2] as { _id: string })._id)).toEqual(['referral:01CAPACITY']);
	});

	it('destination cannot withdraw a sent referral (403) and nothing is written', async () => {
		mockDb(() => capacitySent);

		await expect(
			repo.transition('referral:01CAPACITY', 'closed', 'Staff B', 'x', 'SH002')
		).rejects.toMatchObject({ status: 403 });
		expect(putCalls()).toHaveLength(0);
	});

	it('accept arriving after a withdraw → 422 with no transfer writes', async () => {
		mockDb(() => ({ ...capacitySent, status: 'closed' }));

		await expect(
			repo.transition('referral:01CAPACITY', 'accepted', 'Staff B', 'ok', 'SH002')
		).rejects.toMatchObject({ status: 422, message: 'Invalid referral transition' });
		expect(putCalls()).toHaveLength(0);
	});

	it('409 retry re-reads the latest referral; a non-sent latest → 422 with no second transfer', async () => {
		let latest: Referral = capacitySent;
		let referralPutAttempts = 0;
		mockDb(
			() => latest,
			() => {
				referralPutAttempts += 1;
				return referralPutAttempts === 1 ? 409 : 201;
			}
		);

		// Attempt 1 sees `sent`, runs the transfer, then loses the referral write (409).
		await expect(
			repo.transition('referral:01CAPACITY', 'accepted', 'Staff B', 'ok', 'SH002')
		).rejects.toMatchObject({ status: 409 });
		const putsAfterFirstAttempt = putCalls().length;
		expect(putsAfterFirstAttempt).toBeGreaterThan(0);

		// Meanwhile another writer rejected the referral. The BFF retry calls transition() again,
		// which must read the latest doc and refuse before touching any transfer docs.
		latest = { ...capacitySent, status: 'rejected' };
		await expect(
			repo.transition('referral:01CAPACITY', 'accepted', 'Staff B', 'ok', 'SH002')
		).rejects.toMatchObject({ status: 422, message: 'Invalid referral transition' });

		expect(putCalls()).toHaveLength(putsAfterFirstAttempt);
	});
});

describe('CouchDbReferralServerRepository create() with a mononym evacuee', () => {
	it('writes the referral when the evacuee summary has an empty last_name', async () => {
		vi.clearAllMocks();
		adminRaw.mockImplementation(async (_path: string, method: string, body?: { _id?: string }) =>
			method === 'PUT'
				? { status: 201, data: { ok: true, id: body?._id, rev: '1-new' } }
				: { status: 200, data: {} }
		);
		const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');

		const doc = await repo.create(
			{
				referral_type: 'medical-emergency',
				evacuee_id: 'evacuee:01MONONYM',
				reason: 'ต้องการการรักษา',
				urgency: 'normal',
				to_org: { name: 'โรงพยาบาลทดสอบ', kind: 'hospital' }
			} as never,
			{ shelterCode: 'SH001', createdBy: 'Staff A' },
			{ first_name: 'ทดสอบ', last_name: '' }
		);

		expect(doc.status).toBe('draft');
		expect(doc.schema_v).toBe(2);
		expect(doc.evacuee_summary).toEqual({ first_name: 'ทดสอบ', last_name: '' });
		const written = adminRaw.mock.calls.find((c) => c[1] === 'PUT' && c[2]?._id === doc._id);
		expect(written).toBeTruthy();
	});
});

describe('CouchDbReferralServerRepository listPage()', () => {
	const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');

	function findBody(): Record<string, unknown> {
		const call = adminRaw.mock.calls.find((c) => String(c[0]).endsWith('/_find'));
		return call![2] as Record<string, unknown>;
	}

	function stubFind(docs: unknown[], bookmark = 'bm-next') {
		adminRaw.mockImplementation(async (path: string) => {
			if (path.endsWith('/_find')) return { status: 200, data: { docs, bookmark } };
			return { status: 201, data: { ok: true } };
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('outgoing: selects on shelter_code and sorts every index field desc', async () => {
		stubFind([]);
		await repo.listPage({ direction: 'outgoing', status: 'sent' });
		const body = findBody();
		expect(body.selector).toEqual({ type: 'referral', shelter_code: 'SH001', status: 'sent' });
		expect(body.sort).toEqual([{ type: 'desc' }, { shelter_code: 'desc' }, { created_at: 'desc' }]);
		expect(body).not.toHaveProperty('skip');
	});

	it('incoming: selects on to_shelter_code and sorts asc when created_at_asc', async () => {
		stubFind([]);
		await repo.listPage({ direction: 'incoming', sort: 'created_at_asc' });
		const body = findBody();
		expect(body.selector).toEqual({ type: 'referral', to_shelter_code: 'SH001' });
		expect(body.sort).toEqual([{ type: 'asc' }, { to_shelter_code: 'asc' }, { created_at: 'asc' }]);
	});

	it('sends the bookmark and never skip when a bookmark is given', async () => {
		stubFind([]);
		await repo.listPage({ direction: 'outgoing', bookmark: 'bm-1', skip: 20 });
		const body = findBody();
		expect(body.bookmark).toBe('bm-1');
		expect(body).not.toHaveProperty('skip');
	});

	it('omits bookmark on the first page and returns Couch bookmark', async () => {
		stubFind([capacitySent], 'bm-out');
		const page = await repo.listPage({ direction: 'outgoing', limit: 5 });
		expect(findBody()).not.toHaveProperty('bookmark');
		expect(page.bookmark).toBe('bm-out');
		expect(page.items).toEqual([capacitySent]);
		expect(page.hasMore).toBe(false);
	});

	it('hasMore is true when a full page comes back, even if a malformed doc is dropped', async () => {
		stubFind([capacitySent, { _id: 'referral:broken', type: 'referral' }]);
		const page = await repo.listPage({ direction: 'outgoing', limit: 2 });
		expect(page.items).toHaveLength(1);
		expect(page.hasMore).toBe(true);
	});

	it('hasMore is false on an empty last page that still carries a bookmark', async () => {
		stubFind([], 'bm-end');
		const page = await repo.listPage({ direction: 'outgoing', limit: 2 });
		expect(page).toEqual({ items: [], bookmark: 'bm-end', hasMore: false });
	});

	it('keeps the legacy $or selector when no direction is given (evacuee lookup)', async () => {
		stubFind([]);
		await repo.list({ evacuee_id: 'evacuee:1' });
		const body = findBody();
		expect(body.selector).toEqual({
			type: 'referral',
			$or: [{ shelter_code: 'SH001' }, { to_shelter_code: 'SH001' }],
			evacuee_id: 'evacuee:1'
		});
		expect(body.sort).toEqual([{ type: 'desc' }, { created_at: 'desc' }]);
	});
});

describe('CouchDbReferralServerRepository transition() close_reason (CR-167 FR-C2, FR-C5)', () => {
	it('closing an accepted v1 referral stores close_reason, keeps response_reason, lifts to v2', async () => {
		vi.clearAllMocks();
		const accepted: Referral = {
			...capacitySent,
			status: 'accepted',
			response_reason: 'ปลายทางตอบรับ',
			timeline: {
				sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' },
				responded: { at: '2026-07-11T06:00:00.000Z', by: 'Staff B' }
			}
		};
		adminRaw.mockImplementation(async (path: string, method: string, body?: { _id?: string }) => {
			if (method === 'GET' && decodeURIComponent(path).includes('referral:01CAPACITY')) {
				return { status: 200, data: accepted };
			}
			if (method === 'PUT') return { status: 201, data: { ok: true, id: body?._id, rev: '2-new' } };
			return { status: 200, data: {} };
		});
		const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');

		const result = await repo.transition(
			'referral:01CAPACITY',
			'closed',
			'Staff A',
			'ปิดงาน',
			'SH001'
		);

		expect(result.schema_v).toBe(2);
		expect(result.close_reason).toBe('ปิดงาน');
		expect(result.response_reason).toBe('ปลายทางตอบรับ');
		const written = adminRaw.mock.calls.find(
			(c) => c[1] === 'PUT' && c[2]?._id === 'referral:01CAPACITY'
		);
		expect(written?.[2]).toMatchObject({ schema_v: 2, close_reason: 'ปิดงาน' });
	});
});

describe('CouchDbReferralServerRepository.getBatchFor', () => {
	const anchor: Referral = {
		...capacitySent,
		_id: 'referral:a',
		created_at: '2026-07-11T05:03:10.000Z'
	};
	const sibling: Referral = {
		...anchor,
		_id: 'referral:b',
		created_at: '2026-07-11T05:03:50.000Z'
	};
	const other: Referral = { ...anchor, _id: 'referral:c', reason: 'Different' };

	beforeEach(() => vi.clearAllMocks());

	it('queries the anchor shelter_code bucket and keeps only matching batch keys', async () => {
		adminRaw.mockResolvedValue({ status: 200, data: { docs: [anchor, other, sibling] } });
		const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');
		const items = await repo.getBatchFor(anchor);

		expect(items.map((r) => r._id)).toEqual(['referral:a', 'referral:b']);
		const [path, method, body] = adminRaw.mock.calls.at(-1)!;
		expect(path).toBe('/central_ops/_find');
		expect(method).toBe('POST');
		expect(body.selector).toEqual({
			type: 'referral',
			shelter_code: 'SH001',
			created_at: { $gte: '2026-07-11T05:02:00.000Z', $lt: '2026-07-11T05:04:00.000Z' }
		});
		expect(body.sort).toEqual([{ type: 'asc' }, { shelter_code: 'asc' }, { created_at: 'asc' }]);
		expect(body.limit).toBe(200);
		expect(body.bookmark).toBeUndefined();
	});

	it.each([
		['an incoming viewer', 'SH002'],
		['an SA viewing another shelter', 'SH009']
	])('uses the anchor shelter_code for %s', async (_label, viewer) => {
		adminRaw.mockResolvedValue({ status: 200, data: { docs: [anchor] } });
		const repo = new CouchDbReferralServerRepository('central_ops', viewer);
		expect(await repo.getBatchFor(anchor)).toHaveLength(1);
		const body = adminRaw.mock.calls.at(-1)![2];
		expect(body.selector.shelter_code).toBe('SH001');
		expect(body.selector.to_shelter_code).toBeUndefined();
	});

	it('pages through the bucket by bookmark until a short page', async () => {
		const full = Array.from({ length: 200 }, (_, i) =>
			i === 0 ? anchor : { ...other, _id: `referral:o${i}` }
		);
		const tail = Array.from({ length: 49 }, (_, i) => ({ ...sibling, _id: `referral:t${i}` }));
		adminRaw
			.mockResolvedValueOnce({ status: 200, data: { docs: full, bookmark: 'bm1' } })
			.mockResolvedValueOnce({ status: 200, data: { docs: [sibling, ...tail], bookmark: 'bm2' } });
		const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');
		const items = await repo.getBatchFor(anchor);

		expect(items).toHaveLength(51);
		expect(adminRaw).toHaveBeenCalledTimes(2);
		expect(adminRaw.mock.calls[0]![2].bookmark).toBeUndefined();
		expect(adminRaw.mock.calls[1]![2].bookmark).toBe('bm1');
	});

	it('throws instead of returning a partial batch past the page cap', async () => {
		const full = Array.from({ length: 200 }, (_, i) => ({ ...other, _id: `referral:o${i}` }));
		adminRaw.mockResolvedValue({ status: 200, data: { docs: full, bookmark: 'bm' } });
		const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');
		await expect(repo.getBatchFor(anchor)).rejects.toThrow('page cap');
		expect(adminRaw).toHaveBeenCalledTimes(50);
	});

	it('throws when CouchDB fails', async () => {
		adminRaw.mockResolvedValue({ status: 500, data: {} });
		const repo = new CouchDbReferralServerRepository('central_ops', 'SH001');
		await expect(repo.getBatchFor(anchor)).rejects.toThrow('_find');
	});
});
