import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { PublicDonationDoc, DonationRedirect } from '$lib/features/donations';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const baseDonation = {
	_id: 'donation:123',
	_rev: '1-abc',
	type: 'donation',
	schema_v: 4,
	status: 'pending_review',
	shelter_code: 'SH001',
	booking_ref: 'DN-999999',
	tracking_token_hash: 'secret-hash',
	donor: { name: 'John Donor', phone: '0812345678', email: 'john@donor.com' },
	items: [{ item_id: 'item:rice', qty: '10', unit: 'kg', note: 'ใหม่' }]
} as unknown as PublicDonationDoc;

function mockCouch(donation: PublicDonationDoc, over: { putStatus?: number } = {}) {
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
		if (method === 'GET' && path.includes('donation:')) {
			// Only the origin shelter holds the donation.
			return Promise.resolve({
				status: 200,
				data: { rows: path.includes('shelter_sh001') ? [{ doc: donation }] : [] }
			});
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			return Promise.resolve({ status: 201, data: [{ ok: true }] });
		}
		if (method === 'PUT' && path.includes('/shelter_sh001/')) {
			return Promise.resolve({ status: over.putStatus ?? 201, data: { ok: true } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

/**
 * All `_bulk_docs` batches, keyed by the db they were written to. The doc type is
 * deliberately open: one assertion below checks that NO `stock_ledger` row shows
 * up, which a narrowed union would make unexpressible.
 */
type WrittenDoc = {
	type: string;
	shelter_code?: string;
	origin_shelter_code?: string;
	origin_donation_id?: string;
	booking_ref?: string | null;
	status?: string;
	note?: string | null;
	donor?: DonationRedirect['donor'];
};

function batches(): { db: string; docs: WrittenDoc[] }[] {
	return vi
		.mocked(adminRaw)
		.mock.calls.filter((c) => String(c[0]).includes('_bulk_docs'))
		.map((c) => ({
			db: String(c[0]).split('/')[1],
			docs: (c[2] as { docs: WrittenDoc[] }).docs
		}));
}

function postEvent(body: unknown, query = 'DN-999999'): PostEvent {
	return {
		params: { query },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(body) }
	} as unknown as PostEvent;
}

// R-16.4 · CR-087
describe('POST /api/back-office/donations/[query]/redirect', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
	});

	it('writes the ticket into the DESTINATION db and the audit into the origin db', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ target_shelter_code: 'SH002', note: 'ศูนย์เต็ม' }));
		expect(response.status).toBe(200);

		const written = batches();
		const auditBatch = written.find((b) => b.docs.some((d) => d.type === 'audit'));
		const ticketBatch = written.find((b) => b.docs.some((d) => d.type === 'donation_redirect'));

		expect(auditBatch?.db).toBe('shelter_sh001');
		expect(ticketBatch?.db).toBe('shelter_sh002');

		const ticket = ticketBatch?.docs.find((d) => d.type === 'donation_redirect');
		expect(ticket).toMatchObject({
			shelter_code: 'SH002', // envelope belongs to the destination db
			origin_shelter_code: 'SH001',
			origin_donation_id: 'donation:123',
			booking_ref: 'DN-999999',
			status: 'pending_review',
			note: 'ศูนย์เต็ม'
		});
		expect(ticket?.donor).toEqual({ name: 'John Donor', phone: '0812345678' });
		// No donor email/hash crosses the shelter boundary (data minimization).
		expect(ticket?.donor).not.toHaveProperty('email');
	});

	it('never writes a stock_ledger row — the goods never entered this shelter', async () => {
		mockCouch(baseDonation);

		await POST(postEvent({ target_shelter_code: 'SH002' }));

		const allDocs = batches().flatMap((b) => b.docs);
		expect(allDocs.filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
	});

	it('moves the origin donation to redirected and records the destination', async () => {
		mockCouch(baseDonation);

		await POST(postEvent({ target_shelter_code: 'SH002' }));

		const put = vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT');
		expect(put?.[0]).toBe('/shelter_sh001/donation:123');
		expect(put?.[2]).toMatchObject({
			status: 'redirected',
			redirect_to_shelter_code: 'SH002'
		});
	});

	it('rejects a status that cannot be redirected', async () => {
		mockCouch({ ...baseDonation, status: 'received' } as PublicDonationDoc);

		const response = await POST(postEvent({ target_shelter_code: 'SH002' }));
		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('INVALID_TRANSITION');
		expect(batches()).toHaveLength(0);
	});

	it('rejects redirecting to the shelter that already holds the donation', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ target_shelter_code: 'SH001' }));
		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('SAME_SHELTER');
		expect(batches()).toHaveLength(0);
	});

	it('rejects an unknown destination shelter', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ target_shelter_code: 'SH999' }));
		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('UNKNOWN_SHELTER');
		expect(batches()).toHaveLength(0);
	});

	it('rejects a missing destination shelter', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({}));
		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('TARGET_SHELTER_REQUIRED');
	});

	it('returns 403 when staff redirect another shelter donation', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH002', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockCouch(baseDonation);

		const response = await POST(postEvent({ target_shelter_code: 'SH002' }));
		expect(response.status).toBe(403);
		expect(batches()).toHaveLength(0);
	});
});
