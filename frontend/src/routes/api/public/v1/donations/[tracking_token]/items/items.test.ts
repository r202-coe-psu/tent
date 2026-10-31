import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import {
	CouchReadError,
	fetchDocsStrict,
	hasKeyedDonationStock,
	readDonationCampaign
} from '$lib/server/donation-docs';
import { DONATION_SCHEMA_V } from '$lib/features/operations/server';

type PatchEvent = Parameters<typeof PATCH>[0];

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));
vi.mock('$lib/server/donation-docs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/donation-docs')>();
	return {
		CouchReadError: actual.CouchReadError,
		// Real lookup over the mocked `adminRaw`, so `couchHas` drives it.
		findByTokenHash: actual.findByTokenHash,
		fetchDocsStrict: vi.fn(async () => []),
		hasKeyedDonationStock: vi.fn(async () => false),
		readDonationCampaign: vi.fn(async () => null),
		GOODS_IN_STOCK_ERROR: { success: false, error: 'GOODS_IN_STOCK', message: 'in stock' }
	};
});
vi.mock('$lib/server/couch-public-writer', () => ({ putAsPublicWriter: vi.fn() }));
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
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: {} });
		vi.mocked(fetchDocsStrict).mockResolvedValue([]);
		vi.mocked(hasKeyedDonationStock).mockResolvedValue(false);
		vi.mocked(readDonationCampaign).mockResolvedValue(null);
	});

	// Owner decision 2026-10-22 — goods already keyed for this booking: the donor can no
	// longer move its lines, which would re-number them under the stock rows.
	it('refuses an edit once goods of the booking are in stock, moving no quota', async () => {
		couchHas(couchDoc('pending_review'));
		fastapiOk();
		vi.mocked(hasKeyedDonationStock).mockResolvedValue(true);

		const response = await call();

		expect(response.status).toBe(409);
		expect((await response.json()).error).toBe('GOODS_IN_STOCK');
		expect(fetch).not.toHaveBeenCalled();
		expect(putAsPublicWriter).not.toHaveBeenCalled();
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
		// FR-18b — the current version, not a stale constant.
		expect((written as { schema_v: number }).schema_v).toBe(DONATION_SCHEMA_V);
	});

	// CR-196 FR-LK-4 — refused here, before the headroom reads or any quota moves.
	// CR-175 donor photos FR-3a / AC-12 — editing the lines leaves the photos as booked.
	it('keeps the photos of the booking through an edit', async () => {
		const photos = ['image:01K8PHXTX00000000000000001', 'image:01K8PHXTX00000000000000002'];
		couchHas({ ...couchDoc('pending_review'), photos });
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(200);
		const [, , written] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
		expect((written as { photos: string[] }).photos).toEqual(photos);
	});

	describe('a booking something was decided on', () => {
		it.each([
			['its QR is out', couchDoc('verifying')],
			['it was refused', couchDoc('rejected')],
			[
				'the campaign rule approved a line',
				{
					...couchDoc('pending_review'),
					items: [
						{ item_id: 'item:rice', qty: '5', unit: 'kg', review_status: 'approved' },
						{ free_text: 'ผ้าห่ม', qty: '1', unit: 'ผืน', review_status: 'pending' }
					]
				}
			],
			[
				'staff refused a line',
				{
					...couchDoc('pending_review'),
					items: [{ free_text: 'ผ้าห่ม', qty: '1', unit: 'ผืน', review_status: 'rejected' }]
				}
			]
		])('answers ALREADY_REVIEWED when %s', async (_, doc) => {
			couchHas(doc);
			fastapiOk();

			const response = await call();

			expect(response.status).toBe(400);
			expect((await response.json()).error).toBe('ALREADY_REVIEWED');
			expect(fetchDocsStrict).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
			expect(putAsPublicWriter).not.toHaveBeenCalled();
		});
	});

	// CR-174 FR-18 / FR-18b / FR-26
	describe('per-line review after an edit (CR-174)', () => {
		it('sends FastAPI the booking as it stands in CouchDB, line keys included', async () => {
			const held = [
				{ free_text: 'ผ้าห่ม', qty: '1', unit: 'ผืน', review_status: 'pending', line_key: 'K1' }
			];
			couchHas({ ...couchDoc('pending_review'), items: [...held] });
			fastapiOk();

			await call([{ line_key: 'K1', free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน' }]);

			const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
			expect(body).toMatchObject({
				items: [{ line_key: 'K1', qty: '2' }],
				current_items: held,
				current_status: 'pending_review'
			});
		});

		it('AC-14: writes the status FastAPI worked out back to CouchDB', async () => {
			couchHas(couchDoc('pending_review'));
			fastapiOk({ status: 'verifying' });

			const response = await call();

			const [, , written] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
			expect(written).toMatchObject({ status: 'verifying', schema_v: DONATION_SCHEMA_V });
			expect((await response.json()).status).toBe('verifying');
		});

		it('writes the line keys FastAPI returned onto the CouchDB doc', async () => {
			couchHas(couchDoc('pending_review'));
			fastapiOk({
				status: 'pending_review',
				items: [{ free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน', line_key: 'K-NEW' }]
			});

			await call();

			const [, , written] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
			expect((written as { items: { line_key?: string }[] }).items[0]!.line_key).toBe('K-NEW');
		});

		// A doc a newer writer stamped keeps its version: stamping the current one over it would claim it
		// lacks fields it has.
		it('never lowers the schema_v of a doc a newer writer stamped', async () => {
			couchHas({ ...couchDoc('pending_review'), schema_v: DONATION_SCHEMA_V + 1 });
			fastapiOk({ status: 'pending_review' });

			await call();

			const [, , written] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
			expect(written).toMatchObject({ schema_v: DONATION_SCHEMA_V + 1 });
		});

		it('AC-22: audits the lines the campaign rule approved in this edit, after the write', async () => {
			couchHas(couchDoc('pending_review'));
			fastapiOk({ status: 'verifying', auto_approved_lines: [0] });

			await call();

			const auditCall = vi
				.mocked(adminRaw)
				.mock.calls.find((c) => String(c[0]).includes('_bulk_docs'));
			const [audit] = (auditCall![2] as { docs: Record<string, unknown>[] }).docs;
			expect(audit).toMatchObject({
				type: 'audit',
				action: 'manual_adjust',
				target_id: 'donation:1',
				created_by: 'system',
				context: { approved_by: 'system', rule: 'campaign_line', lines: [0] }
			});
		});

		// Review #783 M2 — the edit has landed by now: the donor must hear it did, or a retry
		// moves the quota at FastAPI a second time. A lost audit is logged, not swallowed.
		describe('when the audit cannot be written', () => {
			function auditAnswers(answer: () => Promise<unknown>) {
				const base = vi.mocked(adminRaw).getMockImplementation()!;
				vi.mocked(adminRaw).mockImplementation((path, method, body) =>
					String(path).includes('_bulk_docs')
						? (answer() as ReturnType<typeof adminRaw>)
						: base(path, method, body)
				);
			}

			it('logs a row CouchDB refused inside a 201', async () => {
				couchHas(couchDoc('pending_review'));
				fastapiOk({ status: 'verifying', auto_approved_lines: [0] });
				auditAnswers(async () => ({
					status: 201,
					data: [{ id: 'audit:x', error: 'forbidden', reason: 'not allowed' }]
				}));
				const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

				const response = await call();

				expect(response.status).toBe(200);
				expect(logged).toHaveBeenCalledWith(
					'donation auto-approve audit failed',
					expect.anything()
				);
				logged.mockRestore();
			});

			it('still reports the edit when the audit request throws', async () => {
				couchHas(couchDoc('pending_review'));
				fastapiOk({ status: 'verifying', auto_approved_lines: [0] });
				auditAnswers(() => Promise.reject(new Error('socket hang up')));
				const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

				const response = await call();

				expect(response.status).toBe(200);
				expect((await response.json()).success).toBe(true);
				logged.mockRestore();
			});
		});

		it('writes no audit when nothing new was approved', async () => {
			couchHas(couchDoc('pending_review'));
			fastapiOk({ status: 'pending_review', auto_approved_lines: [] });

			await call();

			expect(vi.mocked(adminRaw).mock.calls.some((c) => String(c[0]).includes('_bulk_docs'))).toBe(
				false
			);
		});
	});

	// S-R5-3 — a failed read used to look like "not synced yet": the edit skipped the
	// status and stock checks and moved quota at FastAPI while CouchDB stayed as it was.
	it('stops before moving quota when CouchDB cannot be read', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 500, data: { error: 'unknown_error' } });
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('DONATION_UNAVAILABLE');
		expect(fetch).not.toHaveBeenCalled();
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('stops the same way when the stock check cannot read CouchDB', async () => {
		couchHas(couchDoc());
		vi.mocked(hasKeyedDonationStock).mockRejectedValue(
			new CouchReadError('shelter_sh001', 'stock_ledger (ref_id)', 500)
		);
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('DONATION_UNAVAILABLE');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('treats a shelter with no database as a booking CouchDB has not seen', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: { error: 'not_found' } });
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(200);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
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
		couchHas(couchDoc('received'));
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Cannot edit a donation in status "received"');
		expect(fetch).not.toHaveBeenCalled();
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('still lets the donor edit while the booking sits in review', async () => {
		// CR-052 §1.4 opens every wizard booking at `pending_review`, so gating on
		// `declared` alone would take edit away from every donation the public makes.
		couchHas(couchDoc('pending_review'));
		fastapiOk();

		const response = await call();

		expect(response.status).toBe(200);
		expect(putAsPublicWriter).toHaveBeenCalled();
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
			vi.mocked(fetchDocsStrict).mockImplementation(async (_db: string, prefix: string) => {
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

		// Full-branch review — an unreadable ledger is not an empty one: read as [] it
		// looked like headroom and let the edit past the target.
		it('stops before moving quota when the stock cannot be read', async () => {
			couchWorld('80', 0);
			vi.mocked(fetchDocsStrict).mockRejectedValue(
				new CouchReadError('shelter_sh001', 'stock_ledger:', 500)
			);
			fastapiOk();

			const response = await call(blanket('100'));

			expect(response.status).toBe(503);
			expect((await response.json()).error).toBe('DONATION_UNAVAILABLE');
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

	describe('drop-off point per line, set by staff (FR-AP-15a, FR-AP-15b)', () => {
		const dropOffDoc = (extra: Record<string, unknown> = {}) => ({
			...couchDoc('pending_review'),
			shelter_code: 'SH001',
			campaign_id: 'c1',
			logistics: { delivery_method: 'self_dropoff', vehicle: 'car' },
			...extra
		});
		const campaign = (status: 'open' | 'closed' = 'open') =>
			({
				_id: 'c1',
				type: 'donation_campaign',
				status,
				needs: [
					{ item_id: 'item:rice', qty_target: '100', unit: 'kg', drop_off_point_id: 'point-gym' }
				]
			}) as never;
		const RICE = { item_id: 'item:rice', free_text: 'ข้าวสาร', qty: '5', unit: 'kg' };
		const BLANKET = { free_text: 'ผ้าห่ม', qty: '1', unit: 'piece' };
		const sentPoints = () => {
			const [, init] = vi.mocked(fetch).mock.calls[0]!;
			return (
				JSON.parse(String((init as RequestInit).body)).items as Array<Record<string, unknown>>
			).map((item) => item.drop_off_point_id);
		};

		it("writes every line's point from the booking's campaign over what the client sent (AC-AP-14)", async () => {
			couchHas(dropOffDoc());
			vi.mocked(readDonationCampaign).mockResolvedValue(campaign());
			fastapiOk();

			const response = await call([
				{ ...RICE, drop_off_point_id: null },
				{ ...BLANKET, drop_off_point_id: 'point-med' }
			]);

			expect(response.status).toBe(200);
			expect(readDonationCampaign).toHaveBeenCalledWith('shelter_sh001', 'c1');
			expect(sentPoints()).toEqual(['point-gym', null]);
		});

		it('gives a point to a line the carried item_id makes a campaign line', async () => {
			couchHas(
				dropOffDoc({ items: [{ item_id: 'item:rice', qty: '5', unit: 'kg', line_key: 'k1' }] })
			);
			vi.mocked(readDonationCampaign).mockResolvedValue(campaign());
			fastapiOk();

			await call([{ line_key: 'k1', free_text: 'ข้าวสาร', qty: '6', unit: 'kg' }]);

			expect(sentPoints()).toEqual(['point-gym']);
		});

		it('reads a campaign closed since the booking (AC-AP-14b)', async () => {
			couchHas(dropOffDoc());
			vi.mocked(readDonationCampaign).mockResolvedValue(campaign('closed'));
			fastapiOk();

			await call([RICE]);

			expect(sentPoints()).toEqual(['point-gym']);
		});

		it('stops before moving quota when the campaign cannot be read (AC-AP-14b)', async () => {
			couchHas(dropOffDoc());
			vi.mocked(readDonationCampaign).mockRejectedValue(
				new CouchReadError('shelter_sh001', 'c1', 500)
			);
			fastapiOk();

			const response = await call([RICE]);

			expect(response.status).toBe(503);
			expect((await response.json()).error).toBe('DONATION_UNAVAILABLE');
			expect(fetch).not.toHaveBeenCalled();
			expect(putAsPublicWriter).not.toHaveBeenCalled();
		});

		it('writes null when the campaign doc is gone', async () => {
			couchHas(dropOffDoc());
			fastapiOk();

			await call([RICE]);

			expect(sentPoints()).toEqual([null]);
		});

		it('writes null for every line before the booking reaches CouchDB', async () => {
			couchHas(null);
			fastapiOk();

			await call([{ ...RICE, drop_off_point_id: 'point-gym' }]);

			expect(readDonationCampaign).not.toHaveBeenCalled();
			expect(sentPoints()).toEqual([null]);
		});

		it('writes null for every line of a booking that is not a self drop-off', async () => {
			couchHas(dropOffDoc({ logistics: { delivery_method: 'parcel' } }));
			vi.mocked(readDonationCampaign).mockResolvedValue(campaign());
			fastapiOk();

			await call([RICE]);

			expect(sentPoints()).toEqual([null]);
		});

		it('writes the points FastAPI returned and stamps the current schema_v', async () => {
			couchHas(dropOffDoc());
			fastapiOk({
				items: [{ ...RICE, drop_off_point_id: 'point-gym' }]
			});

			await call([RICE]);

			const [, , written] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
			const doc = written as { items: Array<Record<string, unknown>>; schema_v: number };
			expect(doc.items[0].drop_off_point_id).toBe('point-gym');
			expect(doc.schema_v).toBe(DONATION_SCHEMA_V);
		});

		// FR-MP-17 / FR-MP-17a / AC-9 — the real guard: a receipt alone starts the booking.
		it('refuses an edit once a point recorded a receipt, moving no quota (AC-9)', async () => {
			const actual = await vi.importActual<typeof import('$lib/server/donation-docs')>(
				'$lib/server/donation-docs'
			);
			vi.mocked(hasKeyedDonationStock).mockImplementation(actual.hasKeyedDonationStock);
			couchHas(
				dropOffDoc({
					point_receipts: [{ point_id: 'point-gym', line_nos: [0], ledger_ids: [] }]
				})
			);
			fastapiOk();

			const response = await call([RICE]);

			expect(response.status).toBe(409);
			expect((await response.json()).error).toBe('GOODS_IN_STOCK');
			expect(fetch).not.toHaveBeenCalled();
			expect(putAsPublicWriter).not.toHaveBeenCalled();
		});
	});
});
