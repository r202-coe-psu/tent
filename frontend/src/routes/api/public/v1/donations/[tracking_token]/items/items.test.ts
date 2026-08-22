import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { donationEditLimiter } from '$lib/server/security/rate-limiter';
import { sha256Hex } from '$lib/db/hash';
import { fetchDocs } from '$lib/server/donation-docs';

type PatchEvent = Parameters<typeof PATCH>[0];

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));
vi.mock('$lib/server/donation-docs', () => ({ fetchDocs: vi.fn(async () => []) }));
vi.mock('$lib/server/couch-public-writer', () => ({ putAsPublicWriter: vi.fn() }));
vi.mock('$lib/server/security/rate-limiter', () => ({
	donationIpLimiter: { check: vi.fn(() => true) },
	donationPhoneLimiter: { check: vi.fn(() => true) },
	donationEditLimiter: { check: vi.fn(() => true) },
	donationReadLimiter: { check: vi.fn(() => true) }
}));
vi.mock('$env/dynamic/private', () => ({
	env: { FASTAPI_INTERNAL_URL: 'http://localhost:9000', EXTERNAL_API_SECRET: 'test-secret' }
}));

const TOKEN = 'TX-SH001-EDITME';
// findByTokenHash matches on the real hash, so the fixture has to carry the real one.
const TOKEN_HASH = await sha256Hex(TOKEN);
const ITEMS = [{ item_id: 'item:rice', free_text: 'ข้าวสาร', qty: '8', unit: 'kg' }];

function couchHas(doc: Record<string, unknown> | null) {
	vi.mocked(adminRaw).mockResolvedValue({
		status: 200,
		data: { rows: doc ? [{ doc }] : [] }
	});
}

function couchDoc(status = 'declared') {
	return {
		_id: 'donation:1',
		_rev: '1-abc',
		type: 'donation',
		status,
		tracking_token_hash: TOKEN_HASH,
		items: [{ item_id: 'item:rice', qty: '5', unit: 'kg' }]
	};
}

function fastapiOk(body: Record<string, unknown> = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				success: true,
				revisions: 1,
				items: [{ item_id: 'item:rice', qty: '8', unit: 'kg', reserved_qty: '8' }],
				revision: { at: '2026-08-21T00:00:00Z', by: 'donor', items_before: [], items_after: [] },
				...body
			})
		})
	);
}

function fastapiFails(status: number, detail: Record<string, unknown>) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ errors: [detail] }) })
	);
}

const call = (items: unknown = ITEMS, token = TOKEN) =>
	PATCH({
		params: { tracking_token: token },
		request: { json: () => Promise.resolve({ items }) },
		getClientAddress: () => '127.0.0.1'
	} as unknown as PatchEvent);

describe('PATCH /api/public/v1/donations/[token]/items', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
		vi.mocked(donationEditLimiter.check).mockReturnValue(true);
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: {} });
		vi.mocked(fetchDocs).mockResolvedValue([]);
	});

	it('moves the quota before writing CouchDB', async () => {
		// An edit can be refused, unlike a cancel, so the counter has to answer first —
		// otherwise a donor is told the change went through and refused afterwards.
		const order: string[] = [];
		vi.mocked(adminRaw).mockImplementation(async () => {
			order.push('couch-read');
			return { status: 200, data: { rows: [{ doc: couchDoc() }] } };
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => {
				order.push('fastapi');
				return {
					ok: true,
					status: 200,
					json: async () => ({ revisions: 1, items: [], revision: {} })
				};
			})
		);
		vi.mocked(putAsPublicWriter).mockImplementation(async () => {
			order.push('couch-write');
			return { status: 201, data: {} };
		});

		await call();

		expect(order).toEqual(['couch-read', 'fastapi', 'couch-write']);
	});

	it('writes the items and appends the revision the service returned', async () => {
		couchHas(couchDoc());
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(200);
		const [, , written] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
		expect((written as { items: unknown[] }).items).toEqual([
			{ item_id: 'item:rice', qty: '8', unit: 'kg', reserved_qty: '8' }
		]);
		expect((written as { revisions: unknown[] }).revisions).toHaveLength(1);
		expect((written as { schema_v: number }).schema_v).toBe(4);
	});

	it('leaves CouchDB alone when the donation has not synced yet', async () => {
		// Inbound carries the buffer's new items and log across on its next pass.
		couchHas(null);
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(200);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('surfaces NEED_FULL without touching CouchDB', async () => {
		couchHas(couchDoc());
		fastapiFails(409, { success: false, error: 'NEED_FULL', item_id: 'item:rice' });

		const response = await call();

		expect(response.status).toBe(409);
		expect((await response.json()).error).toBe('NEED_FULL');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('refuses before moving quota once staff have taken the booking', async () => {
		// The buffer follows CouchDB a few seconds behind, so checking the record first
		// means no quota is moved and rolled back for a booking that cannot be edited.
		couchHas(couchDoc('pending_review'));
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	// `undefined` is deliberately not in this list: it would hit `call`'s default.
	it.each([[[]], [null], ['not an array']])('rejects an items payload of %p', async (items) => {
		const response = await call(items);
		expect(response.status).toBe(400);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('rejects a malformed tracking token before reaching CouchDB', async () => {
		const response = await call(ITEMS, 'not-a-token');
		expect(response.status).toBe(400);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('returns 429 when the IP is over the rate limit', async () => {
		vi.mocked(donationEditLimiter.check).mockReturnValue(false);
		const response = await call();
		expect(response.status).toBe(429);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('says the quota already moved when the CouchDB write conflicts', async () => {
		// Not "nothing happened": the counter is ahead of the document until recalculate.
		couchHas(couchDoc());
		fastapiOk();
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 409, data: {} });

		const response = await call();

		expect(response.status).toBe(409);
		expect((await response.json()).error).toContain('รีเฟรช');
	});

	describe('warehouse headroom', () => {
		/**
		 * The atomic counter caps reserved_qty at qty_target and knows nothing about the
		 * warehouse, so on its own it let a booking be raised to 100 against a 100-piece
		 * target the shelter already held 80 of. The create route has subtracted on-hand
		 * since T-22; editing has to answer to the same rule.
		 */
		function couchWorld(onHand: string, otherDonations: number) {
			vi.mocked(fetchDocs).mockImplementation(async (_db: string, prefix: string) => {
				if (prefix === 'donation_campaign:')
					return [
						{
							_id: 'c1',
							type: 'donation_campaign',
							status: 'open',
							needs: [{ item_id: 'item:blanket', qty_target: '100', unit: 'piece' }]
						}
					] as never;
				if (prefix === 'donation:')
					return [
						{
							...couchDoc(),
							campaign_id: 'c1',
							items: [{ item_id: 'item:blanket', free_text: 'ผ้าห่ม', qty: '20' }]
						},
						...(otherDonations
							? [
									{
										_id: 'donation:other',
										type: 'donation',
										status: 'declared',
										campaign_id: 'c1',
										items: [{ item_id: 'item:blanket', qty: String(otherDonations) }]
									}
								]
							: [])
					] as never;
				return [
					{
						_id: 'l1',
						type: 'stock_ledger',
						item_id: 'item:blanket',
						qty: onHand,
						reason: 'donation',
						ref_id: null
					}
				] as never;
			});
			couchHas({
				...couchDoc(),
				campaign_id: 'c1',
				items: [{ item_id: 'item:blanket', free_text: 'ผ้าห่ม', qty: '20' }]
			});
		}

		const blanket = (qty: string) => [{ item_id: 'item:blanket', qty, unit: 'piece' }];

		it('refuses a rise the warehouse has already covered', async () => {
			couchWorld('80', 0);
			fastapiOk();

			const response = await call(blanket('100'));

			expect(response.status).toBe(409);
			expect((await response.json()).error).toBe('NEED_FULL');
			expect(fetch).not.toHaveBeenCalled();
		});

		it('allows what is genuinely left', async () => {
			// 100 target − 80 on hand = 20, and this booking already holds all of it.
			couchWorld('80', 0);
			fastapiOk();

			expect((await call(blanket('20'))).status).toBe(200);
		});

		it('counts this booking as headroom rather than competition', async () => {
			// Its own 20 must not be measured against itself, or no edit could ever hold.
			couchWorld('80', 0);
			fastapiOk();

			expect((await call(blanket('15'))).status).toBe(200);
		});

		it('refuses a bare line the client stripped the item_id from', async () => {
			// The hole that let a booking be raised past its target with this check live:
			// FastAPI re-attaches the item_id, but only after this ran, so the line read as
			// untracked here and was reserved a moment later under the identity it regained.
			couchWorld('80', 0);
			fastapiOk();

			const response = await call([{ free_text: 'ผ้าห่ม', qty: '100', unit: 'piece' }]);

			expect(response.status).toBe(409);
			expect((await response.json()).item_id).toBe('item:blanket');
			expect(fetch).not.toHaveBeenCalled();
		});

		it('sends the repaired items on, so both halves reserve the same identity', async () => {
			couchWorld('80', 0);
			fastapiOk();

			await call([{ free_text: 'ผ้าห่ม', qty: '10', unit: 'piece' }]);

			const [, init] = vi.mocked(fetch).mock.calls[0]! as [unknown, RequestInit];
			expect(JSON.parse(init.body as string).items[0].item_id).toBe('item:blanket');
		});

		it('still counts other bookings against the target', async () => {
			couchWorld('50', 40);
			fastapiOk();

			// 100 − 50 on hand − 40 someone else = 10 left.
			expect((await call(blanket('30'))).status).toBe(409);
			expect((await call(blanket('10'))).status).toBe(200);
		});
	});
});
