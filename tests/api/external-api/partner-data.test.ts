/**
 * What the partner plane answers, checked against CouchDB (the system of record) rather than
 * against itself:
 *  - EXT-002/003 location master: lists the seeded shelters, 404 for an unknown code, paging;
 *  - EXT-004 stock: one item per ledgered item, quantities summed from `stock_ledger`;
 *  - EXT-005 occupancy: `active` + `room_confirmed` evacuees and their gender split;
 *  - EXT-007 / EXT-011 / EXT-012 with a probe evacuee written to the seeded shelter: it shows up
 *    masked or in full by scope, its residency follows its stay status, and it disappears once
 *    the doc is deleted.
 * docs/data/api-contract.md §5.3, ADR 0002 §2/§5/§6, CR-154, CR-176, CR-257.
 *
 * UAT-159 (partner plane)
 */
import { expect, test } from '@playwright/test';
import { asAdmin, dbExists, fakeUlid, shelterDb, type CouchDoc } from '../../lib/couch.ts';
import { fastapiTarget, shelterCodes } from '../../lib/env.ts';
import {
	callFastapi,
	fastapiIsUp,
	issueApiKey,
	revokeApiKey,
	type IssuedKey
} from '../../lib/fastapi.ts';
import {
	PARTNER_SCOPES,
	PartnerClients,
	callExt,
	extCode,
	fictitiousCid
} from '../../lib/partner.ts';
import { PURPOSE } from './partner-endpoints.ts';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const { a: CODE, b: CODE_B } = shelterCodes();
const DB = shelterDb(CODE);
const clients = new PartnerClients(RUN);

/** Same as the worker's `IN_SHELTER_STATUSES` (projectors/occupancy.py, #593). */
const IN_SHELTER = new Set(['active', 'room_confirmed']);

let full: string;
let masked: string;
let apiKey: IssuedKey | undefined;
let probe: CouchDoc | undefined;
let probeDeletedRev: string | undefined;
const probeCid = fictitiousCid();

async function couchAll<T>(selector: Record<string, unknown>, fields: string[]): Promise<T[]> {
	const res = await asAdmin<{ docs: T[] }>('POST', `/${DB}/_find`, {
		selector,
		fields,
		limit: 1_000_000
	});
	if (res.status !== 200) throw new Error(`_find on ${DB} failed (HTTP ${res.status})`);
	return res.body.docs;
}

/** Poll `check` until it returns true (the sync worker turns CouchDB writes into Mongo rows). */
async function eventually(what: string, check: () => Promise<boolean>, timeout = 90_000) {
	await expect.poll(check, { message: what, timeout, intervals: [1_000, 2_000, 3_000] }).toBe(true);
}

function residency(token = full, cid = probeCid) {
	return callExt(token, '/external/persons/shelter-residency', { query: { ...PURPOSE, cid } });
}

function personSearch(token: string, search: string) {
	return callExt(token, '/external/persons/search', {
		method: 'POST',
		query: PURPOSE,
		body: { search }
	});
}

async function setProbeStatus(status: string): Promise<void> {
	const current = await asAdmin<CouchDoc>('GET', `/${DB}/${encodeURIComponent(probe!._id)}`);
	const next = {
		...current.body,
		current_stay: { ...(current.body.current_stay as object), status },
		updated_at: new Date().toISOString()
	};
	const put = await asAdmin('PUT', `/${DB}/${encodeURIComponent(probe!._id)}`, next);
	expect(put.status, `update probe to ${status}`).toBeLessThan(300);
}

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
	test.skip(!(await dbExists(DB)), `${DB} is missing: run \`pnpm seed\` in frontend/ first`);
	full = await clients.tokenWith('data-full', PARTNER_SCOPES);
	masked = await clients.tokenWith(
		'data-masked',
		PARTNER_SCOPES.filter((s) => s !== 'pii-full')
	);
});

test.afterAll(async () => {
	if (probe && !probeDeletedRev) {
		const got = await asAdmin<{ _rev: string }>('GET', `/${DB}/${encodeURIComponent(probe._id)}`);
		if (got.status === 200) {
			const del = await asAdmin<{ rev: string }>(
				'DELETE',
				`/${DB}/${encodeURIComponent(probe._id)}?rev=${got.body._rev}`
			);
			probeDeletedRev = del.body?.rev;
		}
	}
	if (probe && probeDeletedRev) {
		// Give the worker a moment to see the deletion before the tombstone is purged.
		await new Promise((r) => setTimeout(r, 5_000));
		await asAdmin('POST', `/${DB}/_purge`, { [probe._id]: [probeDeletedRev] });
	}
	if (apiKey) await revokeApiKey(apiKey.id).catch(() => undefined);
	await clients.cleanup();
});

test.describe('EXT-002/003 location master', () => {
	test('lists both seeded shelters and reads one by code', async () => {
		const list = await callExt(full, '/external/locations', { query: { limit: '200' } });
		expect(list.status).toBe(200);
		const codes = (list.body.result as { location_code: string }[]).map((l) => l.location_code);
		expect(codes).toEqual(expect.arrayContaining([CODE, CODE_B]));

		const one = await callExt(full, `/external/locations/${CODE}`);
		expect(one.status).toBe(200);
		expect(one.body.result.location_code).toBe(CODE);
		expect(typeof one.body.result.accepts_booking).toBe('boolean');
	});

	test('the name agrees with the keyed plane, which reads the same shelter', async () => {
		apiKey = await issueApiKey(`PERMTEST external data ${RUN}`);
		const keyed = await callFastapi<{ shelter: { name: string } }>(
			`/external/v1/shelters/${CODE}`,
			{ headers: { 'X-API-Key': apiKey.api_key } }
		);
		const one = await callExt(full, `/external/locations/${CODE}`);
		expect(one.body.result.name_th).toBe(keyed.body.shelter.name);
	});

	test('an unknown code is 404 location_not_found on every location route', async () => {
		for (const suffix of ['', '/stock', '/occupancy']) {
			const res = await callExt(full, `/external/locations/PERMTEST-NONE${suffix}`);
			expect(res.status, `locations/…${suffix}`).toBe(404);
			expect(extCode(res), `locations/…${suffix}`).toBe('location_not_found');
		}
		const occupants = await callExt(full, '/external/locations/PERMTEST-NONE/occupants', {
			query: PURPOSE
		});
		expect(occupants.status).toBe(404);
	});

	test('pages do not overlap, and limit is capped at 200', async () => {
		const p1 = await callExt(full, '/external/locations', { query: { limit: '1', page: '1' } });
		const p2 = await callExt(full, '/external/locations', { query: { limit: '1', page: '2' } });
		expect(p1.body.result).toHaveLength(1);
		expect(p2.body.result).toHaveLength(1);
		expect(p1.body.result[0].location_code).not.toBe(p2.body.result[0].location_code);
		const over = await callExt(full, '/external/locations', { query: { limit: '201' } });
		expect(over.status).toBe(422);
	});
});

test.describe('EXT-004 stock', () => {
	test('matches the stock ledger in CouchDB', async () => {
		const ledger = await couchAll<{ _id: string; item_id?: string; qty?: string | number }>(
			{ type: 'stock_ledger' },
			['_id', 'item_id', 'qty']
		);
		const rows = ledger.filter((d) => d._id.startsWith('stock_ledger:') && d.item_id);
		const items = new Set(rows.map((d) => d.item_id));
		const total = rows.reduce((sum, d) => sum + Number(d.qty ?? 0), 0);

		const res = await callExt(full, `/external/locations/${CODE}/stock`);
		expect(res.status).toBe(200);
		const got = res.body.result.items as { quantity_on_hand: number; name_th: string }[];
		expect(got.length, 'one item per ledgered item').toBe(items.size);
		const sum = got.reduce((acc, i) => acc + i.quantity_on_hand, 0);
		expect(sum, 'quantities add up to the ledger').toBeCloseTo(total, 3);
		for (const item of got) expect(item.name_th, 'every item has a name').toBeTruthy();
	});
});

test.describe('EXT-005 occupancy', () => {
	test('matches the in-shelter evacuees in CouchDB', async () => {
		const docs = await couchAll<{
			_id: string;
			gender?: string;
			current_stay?: { status?: string };
		}>({ type: 'evacuee' }, ['_id', 'gender', 'current_stay']);
		const inShelter = docs.filter(
			(d) => d._id.startsWith('evacuee:') && IN_SHELTER.has(d.current_stay?.status ?? '')
		);
		const male = inShelter.filter((d) => d.gender === 'male').length;
		const female = inShelter.filter((d) => d.gender === 'female').length;

		const res = await callExt(full, `/external/locations/${CODE}/occupancy`);
		expect(res.status).toBe(200);
		const r = res.body.result;
		expect(r.occupancy_total, 'total').toBe(inShelter.length);
		expect(r.breakdown.male, 'male').toBe(male);
		expect(r.breakdown.female, 'female').toBe(female);
		expect(r.breakdown.male + r.breakdown.female + r.breakdown.gender_unspecified).toBe(
			r.occupancy_total
		);
		expect(r.updated_by_role, 'a role, never a person').toContain('Sync Worker');
	});
});

test.describe('a probe evacuee through EXT-007, EXT-011 and EXT-012', () => {
	test('before it exists its CID has no residency and no search hit', async () => {
		const res = await residency();
		expect(res.status).toBe(404);
		expect(extCode(res)).toBe('residency_not_found');
		const hit = await personSearch(full, probeCid);
		expect(hit.status).toBe(200);
		expect(hit.body.result).toEqual([]);
	});

	test('checked in: EXT-011 reports CHECKED_IN at the seeded shelter', async () => {
		test.setTimeout(120_000);
		const before = (await callExt(full, `/external/locations/${CODE}/occupancy`)).body.result
			.occupancy_total as number;
		const now = new Date().toISOString();
		probe = {
			_id: `evacuee:${fakeUlid()}`,
			type: 'evacuee',
			schema_v: 15,
			shelter_code: CODE,
			created_at: now,
			updated_at: now,
			created_by: 'permtest',
			note: 'PERMTEST external api probe',
			first_name: 'PERMTEST',
			last_name: `Ext${RUN}`,
			gender: 'female',
			birth_year: 2530,
			phone: '0800000000',
			person_id: { cardType: 'national_id', number: probeCid },
			special_needs: ['pregnant'],
			current_stay: { status: 'active', zone: null, since: now },
			privacy: { search_excluded: false }
		};
		const put = await asAdmin('PUT', `/${DB}/${encodeURIComponent(probe._id)}`, probe);
		expect(put.status, 'probe written').toBeLessThan(300);

		await eventually('EXT-011 sees the probe', async () => (await residency()).status === 200);
		const res = await residency();
		expect(res.body.result).toMatchObject({
			location_code: CODE,
			residency_status: 'CHECKED_IN',
			stay_status: 'active',
			in_zone: false
		});
		expect(res.body.result.checkin_datetime).toMatch(/\+07:00$/);
		await eventually(
			'EXT-005 counts the probe',
			async () =>
				(await callExt(full, `/external/locations/${CODE}/occupancy`)).body.result
					.occupancy_total ===
				before + 1
		);
	});

	test('EXT-007 lists the probe masked, or whole with pii-full', async () => {
		test.setTimeout(120_000);
		const ref = `OCC-${probe!._id.replace('evacuee:', '')}`.slice(0, 32);
		const find = async (token: string) => {
			for (let page = 1; page <= 50; page += 1) {
				const res = await callExt(token, `/external/locations/${CODE}/occupants`, {
					query: { ...PURPOSE, limit: '200', page: String(page) }
				});
				expect(res.status).toBe(200);
				const items = res.body.result as Record<string, unknown>[];
				const hit = items.find((i) => i.occupant_ref === ref);
				if (hit || page >= res.body.pagination.total_pages) return { hit, items };
			}
			return { hit: undefined, items: [] };
		};
		await eventually('EXT-007 lists the probe', async () => Boolean((await find(full)).hit));

		const m = await find(masked);
		expect(m.hit, 'masked view lists the probe').toBeDefined();
		for (const key of ['first_name', 'last_name', 'national_id', 'phone', 'name']) {
			expect(m.hit, `masked: no ${key}`).not.toHaveProperty(key);
		}
		expect(m.hit!.care_flags).toEqual(['pregnant']);
		expect(JSON.stringify(m.items).includes(probeCid), 'masked page never has the CID').toBe(false);

		const f = await find(full);
		expect(f.hit).toMatchObject({ first_name: 'PERMTEST', id_card_type: 'national_id' });
		expect(f.hit!.national_id === probeCid, 'full view has the whole CID').toBe(true);
		expect(f.hit!.phone).toBe('0800000000');
	});

	test('EXT-012 finds the probe by CID: masked, or whole with pii-full; never cached', async () => {
		test.setTimeout(120_000);
		await eventually(
			'EXT-012 finds the probe',
			async () => ((await personSearch(full, probeCid)).body.result ?? []).length === 1
		);
		const m = await personSearch(masked, probeCid);
		expect(m.headers['cache-control']).toContain('no-store');
		const [hit] = m.body.result as Record<string, unknown>[];
		expect(hit.status).toBe('active');
		expect(hit.national_id).toMatch(/^\d{3}-XXXX-XX-\d{3}$/);
		for (const key of ['phone', 'first_name', 'last_name', 'family_members']) {
			expect(hit, `masked: no ${key}`).not.toHaveProperty(key);
		}
		expect(JSON.stringify(m.body).includes(probeCid), 'masked answer never has the CID').toBe(
			false
		);

		const f = await personSearch(full, probeCid);
		const [whole] = f.body.result as Record<string, unknown>[];
		expect(whole.national_id === probeCid, 'pii-full gives the whole CID').toBe(true);
		expect(whole.phone).toBe('0800000000');
	});

	test('the keyed plane finds the same probe with the whole CID (CR-257 D-6)', async () => {
		const res = await callFastapi<{ results: Record<string, unknown>[]; count: number }>(
			'/external/v1/occupants',
			{ method: 'POST', headers: { 'X-API-Key': apiKey!.api_key }, body: { search: probeCid } }
		);
		expect(res.status).toBe(200);
		expect(res.body.count).toBe(1);
		expect(res.body.results[0].national_id === probeCid, 'whole CID on /external/v1').toBe(true);
	});

	test('EXT-011 follows the stay: room_confirmed, temporary_leave, checked_out, pre_registered', async () => {
		test.setTimeout(240_000);
		const expected: [string, number, Record<string, unknown>][] = [
			['room_confirmed', 200, { residency_status: 'CHECKED_IN', in_zone: true }],
			['temporary_leave', 200, { residency_status: 'CHECKED_IN', in_zone: false }],
			['checked_out', 200, { residency_status: 'CHECKED_OUT', in_zone: false }],
			// Never checked in at Station 1: not a residency at all (CR-176).
			['pre_registered', 404, {}]
		];
		for (const [status, http, shape] of expected) {
			await setProbeStatus(status);
			await eventually(`EXT-011 after ${status}`, async () => {
				const res = await residency();
				if (res.status !== http) return false;
				return http === 404 || res.body.result.stay_status === status;
			});
			const res = await residency();
			if (http === 200) expect(res.body.result, status).toMatchObject(shape);
			else expect(extCode(res), status).toBe('residency_not_found');
		}
	});

	test('deleted: residency and search forget the probe', async () => {
		test.setTimeout(120_000);
		const got = await asAdmin<{ _rev: string }>('GET', `/${DB}/${encodeURIComponent(probe!._id)}`);
		const del = await asAdmin<{ rev: string }>(
			'DELETE',
			`/${DB}/${encodeURIComponent(probe!._id)}?rev=${got.body._rev}`
		);
		expect(del.status).toBeLessThan(300);
		probeDeletedRev = del.body.rev;
		await eventually('EXT-012 drops the probe', async () => {
			const res = await personSearch(full, probeCid);
			return res.status === 200 && res.body.result.length === 0;
		});
		expect((await residency()).status).toBe(404);
	});

	test('a CID that is not 13 digits is 422, a one-character search is 422', async () => {
		const short = await residency(full, '123');
		expect(short.status).toBe(422);
		expect(extCode(short)).toBe('validation_error');
		const one = await personSearch(full, 'a');
		expect(one.status).toBe(422);
		expect(extCode(one)).toBe('validation_error');
	});
});
