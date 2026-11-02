import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as route from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

const { POST } = route;
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const fullDonor = {
	name: 'สมชาย ใจดี',
	phone: '0812345678',
	phone_hash: 'ph-secret',
	email: 'somchai@example.com'
};

const donationDoc = (over: Record<string, unknown> = {}) => ({
	_id: 'donation:w001',
	type: 'donation',
	status: 'received',
	shelter_code: 'SH001',
	booking_ref: 'DN-306892',
	donor: fullDonor,
	items: [],
	tracking_token_hash: 'th-secret',
	...over
});

/** The one donation the lookup finds; `bulk` answers the audit write. */
function mockCouch(
	opts: {
		donation?: ReturnType<typeof donationDoc>;
		bulk?: { status: number; data: unknown } | Error;
	} = {}
) {
	const doc = opts.donation ?? donationDoc();
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
			return Promise.resolve({ status: 200, data: { rows: [{ doc }] } });
		}
		if (method === 'GET') return Promise.resolve({ status: 200, data: { rows: [] } });
		if (path.endsWith('/_bulk_docs')) {
			if (opts.bulk instanceof Error) return Promise.reject(opts.bulk);
			return Promise.resolve(opts.bulk ?? { status: 201, data: [{ ok: true, id: 'audit:x' }] });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

const post = (query = 'DN-306892') =>
	POST({
		params: { query },
		request: { headers: { get: () => 'session-cookie' } }
	} as unknown as PostEvent);

const bulkCalls = () =>
	vi.mocked(adminRaw).mock.calls.filter((c) => String(c[0]).endsWith('/_bulk_docs'));

const asCaller = (roles: string[], shelterCode: string | null, isSA = false) =>
	vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
		name: 'warehouse01',
		roles,
		isSA,
		shelterCode
	});

describe('POST /api/back-office/donations/[query]/contact (#821 FR-10a)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		asCaller(['shelter:SH001', 'warehouse_staff'], 'SH001');
	});

	it('only POST is exported, so GET is answered 405 by SvelteKit (AC-5b)', () => {
		const handlers = Object.keys(route).filter((k) => /^[A-Z]+$/.test(k));
		expect(handlers).toEqual(['POST']);
		expect(route.prerender).toBe(false);
	});

	it('AC-5d: answers the full contact with Cache-Control: no-store', async () => {
		mockCouch();

		const res = await post();

		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toEqual({
			success: true,
			contact: { name: 'สมชาย ใจดี', phone: '0812345678', email: 'somchai@example.com' }
		});
	});

	it('AC-5b: one call writes exactly one audit row with caller, donation and time', async () => {
		mockCouch();

		await post();

		expect(bulkCalls()).toHaveLength(1);
		const [path, , body] = bulkCalls()[0];
		expect(path).toBe('/shelter_sh001/_bulk_docs');
		const docs = (body as { docs: Array<Record<string, unknown>> }).docs;
		expect(docs).toHaveLength(1);
		expect(docs[0]).toMatchObject({
			type: 'audit',
			action: 'other',
			target_type: 'donation',
			target_id: 'donation:w001',
			reason: 'donor_contact_view',
			created_by: 'warehouse01',
			shelter_code: 'SH001'
		});
		expect(Number.isNaN(Date.parse(String(docs[0].occurred_at)))).toBe(false);
	});

	it('never puts the contact into the audit row', async () => {
		mockCouch();

		await post();

		const text = JSON.stringify(bulkCalls()[0][2]);
		expect(text).not.toContain('สมชาย');
		expect(text).not.toContain('0812345678');
		expect(text).not.toContain('somchai@example.com');
	});

	it('finds the donation by _id as well as by booking_ref (a walk-in has no ref)', async () => {
		mockCouch({ donation: donationDoc({ booking_ref: undefined }) });

		const res = await post('donation:w001');

		expect(res.status).toBe(200);
		expect(bulkCalls()).toHaveLength(1);
	});

	it.each([
		['audit write fails (HTTP 500)', { status: 500, data: { error: 'boom' } }],
		['audit row refused (conflict)', { status: 201, data: [{ id: 'audit:x', error: 'conflict' }] }],
		['audit answer is empty', { status: 201, data: [] }],
		['audit write throws', new Error('network')]
	])('fails closed with 503 and no contact when the %s', async (_label, bulk) => {
		mockCouch({ bulk });

		const res = await post();

		expect(res.status).toBe(503);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const text = JSON.stringify(await res.json());
		expect(text).not.toContain('0812345678');
		expect(text).not.toContain('สมชาย');
	});

	it('FR-10c: contact removed by retention → 200, three nulls, still audited', async () => {
		mockCouch({ donation: donationDoc({ donor: { phone_hash: 'ph-secret' } }) });

		const res = await post();

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			contact: { name: null, phone: null, email: null }
		});
		expect(bulkCalls()).toHaveLength(1);
	});

	it('answers a field-by-field null for a partly removed donor', async () => {
		mockCouch({ donation: donationDoc({ donor: { name: 'ก', phone: '0811111111' } }) });

		expect((await (await post()).json()).contact).toEqual({
			name: 'ก',
			phone: '0811111111',
			email: null
		});
	});

	it('404 and no audit for a donation that does not exist (system admin)', async () => {
		asCaller(['system_admin'], null, true);
		mockCouch();

		const res = await post('DN-000000');

		expect(res.status).toBe(404);
		expect(bulkCalls()).toHaveLength(0);
	});

	it('shelter staff: a ref not in their own shelter is 403 whether it exists elsewhere or not', async () => {
		mockCouch();

		const res = await post('DN-000000');

		expect(res.status).toBe(403);
		expect(bulkCalls()).toHaveLength(0);
	});

	it('AC-5: 403 and no audit for a caller without a warehouse capability', async () => {
		asCaller(['shelter:SH001', 'registration_staff'], 'SH001');
		mockCouch();

		const res = await post();

		expect(res.status).toBe(403);
		expect(bulkCalls()).toHaveLength(0);
	});

	it('AC-5: 403, no audit and no contact for a donation of another shelter', async () => {
		asCaller(['shelter:SH002', 'warehouse_staff'], 'SH002');
		mockCouch();

		const res = await post();

		expect(res.status).toBe(403);
		expect(JSON.stringify(await res.json())).not.toContain('0812345678');
		expect(bulkCalls()).toHaveLength(0);
	});

	it.each([
		['shelter_manager', ['shelter:SH001', 'shelter_manager']],
		['warehouse_staff', ['shelter:SH001', 'warehouse_staff']]
	])('AC-5: a %s of the shelter is let in', async (_label, roles) => {
		asCaller(roles, 'SH001');
		mockCouch();

		expect((await post()).status).toBe(200);
	});

	it('AC-5: a system admin may read a donation of any shelter', async () => {
		asCaller(['system_admin'], null, true);
		mockCouch();

		const res = await post();

		expect(res.status).toBe(200);
		expect(bulkCalls()).toHaveLength(1);
	});
});
