/**
 * EXT-008/009/010 partner bookings against the seeded shelters: create, idempotent replay,
 * key reuse, the worker's write into CouchDB, isolation between clients, cancel (and cancel
 * again), the acceptance rule (#751) with and without `booking-bypass`, and that a booking is
 * never a residency. docs/data/api-contract.md §5.3, CR-154, CR-169, #751.
 *
 * The seed turns no shelter's pre-registration switch on, so the run turns it on for shelter B
 * (`feature_flags.accepts_pre_registration` on its `registry` doc) and restores the original
 * flags at the end; shelter A stays closed to bookings for the #751 cases.
 *
 * Bookings cannot be deleted through the API: each one is cancelled, and the evacuee /
 * household docs the worker wrote for it are deleted and purged from CouchDB at the end. The
 * cancelled booking rows stay in Mongo.
 */
import { expect, test } from '@playwright/test';
import { asAdmin, dbExists, shelterDb, type CouchDoc } from '../../lib/couch.ts';
import { fastapiTarget, shelterCodes } from '../../lib/env.ts';
import { fastapiIsUp, type ApiResult } from '../../lib/fastapi.ts';
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
const clients = new PartnerClients(RUN);

/** Booking id → [shelter code, token that can cancel it]. */
const ledger = new Map<string, [string, string]>();

let owner: string;
let writeOnly: string;
let bypass: string;
let bookable: string | undefined;
let closed: string | undefined;
let bookingId = '';
const cid = fictitiousCid();

const body = (code: string, personCid = fictitiousCid()) => ({
	location_code: code,
	persons: [
		{ cid: personCid, first_name: 'PERMTEST', last_name: `Booking${RUN}`, phone: '+66800000000' }
	]
});

async function book(token: string, payload: unknown, key?: string): Promise<ApiResult> {
	const res = await callExt(token, '/external/bookings', {
		method: 'POST',
		body: payload,
		headers: key ? { 'Idempotency-Key': key } : {}
	});
	if (res.status === 201) {
		const p = payload as { location_code: string };
		ledger.set(res.body.result.booking_id, [p.location_code, token]);
	}
	return res;
}

/** The docs the worker wrote for a booking (it tags them with `booking_ref`). */
async function workerDocs(code: string, id: string) {
	const res = await asAdmin<{
		docs: { _id: string; _rev: string; current_stay?: { status?: string } }[];
	}>('POST', `/${shelterDb(code)}/_find`, {
		selector: { booking_ref: id },
		fields: ['_id', '_rev', 'type', 'current_stay'],
		limit: 50
	});
	return res.body.docs ?? [];
}

async function eventually(what: string, check: () => Promise<boolean>, timeout = 90_000) {
	await expect.poll(check, { message: what, timeout, intervals: [1_000, 3_000] }).toBe(true);
}

/** The shelter's `registry` doc, which carries the staff pre-registration switch (#751). */
async function registryShelter(code: string) {
	const res = await asAdmin<{ docs: (CouchDoc & { feature_flags?: Record<string, unknown> })[] }>(
		'POST',
		'/registry/_find',
		{ selector: { type: 'shelter', code }, limit: 1 }
	);
	return res.body.docs?.[0];
}

/** Original `feature_flags` of a shelter this run switched on (`null` = had none). */
let switched: { code: string; flags: Record<string, unknown> | null } | undefined;

async function setPreRegistration(code: string, flags: Record<string, unknown> | null) {
	const doc = await registryShelter(code);
	if (!doc) throw new Error(`no registry doc for ${code}`);
	const next: CouchDoc = { ...doc, updated_at: new Date().toISOString() };
	if (flags === null) delete next.feature_flags;
	else next.feature_flags = flags;
	const put = await asAdmin('PUT', `/registry/${encodeURIComponent(doc._id)}`, next);
	if (put.status >= 300) throw new Error(`could not update ${code} flags (HTTP ${put.status})`);
}

const acceptsBooking = async (code: string) =>
	(await callExt(owner, `/external/locations/${code}`)).body?.result?.accepts_booking === true;

test.beforeAll(async () => {
	test.setTimeout(150_000);
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
	// No `booking-bypass`: the main flow goes through the normal acceptance rule.
	owner = await clients.tokenWith(
		'book-owner',
		PARTNER_SCOPES.filter((s) => s !== 'booking-bypass')
	);
	writeOnly = await clients.tokenWith('book-write', ['booking-write']);
	bypass = await clients.tokenWith('book-bypass', ['booking-write', 'booking-bypass']);

	// Seeded shelters only: their CouchDB is local, so the run can clean up what the worker wrote.
	const { a, b } = shelterCodes();
	for (const code of [a, b]) {
		test.skip(!(await dbExists(shelterDb(code))), `${shelterDb(code)} is missing: run the seed`);
	}
	closed = (await acceptsBooking(a)) ? undefined : a;
	if (await acceptsBooking(b)) {
		bookable = b;
	} else {
		// The seed leaves the switch off everywhere: turn it on for shelter B for this run only,
		// the way staff do in the shelter form, and put the original flags back in afterAll.
		const original = (await registryShelter(b))?.feature_flags ?? null;
		switched = { code: b, flags: original };
		await setPreRegistration(b, { ...(original ?? {}), accepts_pre_registration: true });
		await eventually(`${b} accepts bookings`, () => acceptsBooking(b));
		bookable = b;
	}
});

test.afterAll(async () => {
	test.setTimeout(240_000);
	for (const [id, [code, token]] of ledger) {
		await callExt(token, `/external/bookings/${id}/cancel`, { method: 'POST' }).catch(() => null);
		// Let the worker apply the cancel, then remove what it wrote.
		await expect
			.poll(
				async () =>
					(await workerDocs(code, id)).every(
						(d) => !d.current_stay || d.current_stay.status === 'cancelled'
					),
				{
					timeout: 60_000
				}
			)
			.toBe(true)
			.catch(() => undefined);
		for (const doc of await workerDocs(code, id)) {
			const db = shelterDb(code);
			const del = await asAdmin<{ rev: string }>(
				'DELETE',
				`/${db}/${encodeURIComponent(doc._id)}?rev=${doc._rev}`
			);
			if (del.body?.rev) {
				await new Promise((r) => setTimeout(r, 1_000));
				await asAdmin('POST', `/${db}/_purge`, { [doc._id]: [del.body.rev] });
			}
		}
	}
	ledger.clear();
	if (switched) {
		await setPreRegistration(switched.code, switched.flags);
		const code = switched.code;
		await eventually(
			`${code} back to not bookable`,
			async () => !(await acceptsBooking(code)),
			60_000
		).catch(() => undefined);
		switched = undefined;
	}
	await clients.cleanup();
});

test('EXT-008 creates a booking; the same key replays it, a different body is refused', async () => {
	test.skip(!bookable, 'no seeded shelter accepts bookings (accepts_booking=false for all)');
	const key = `permtest-${RUN}`;
	const payload = body(bookable!, cid);
	const created = await book(owner, payload, key);
	expect(created.status, `create (code ${extCode(created)})`).toBe(201);
	expect(created.body.result).toMatchObject({
		location_code: bookable,
		booking_status: 'BOOKED',
		persons_count: 1
	});
	bookingId = created.body.result.booking_id;

	const replay = await book(owner, payload, key);
	expect(replay.status).toBe(201);
	expect(replay.body.result.booking_id, 'same booking, not a second one').toBe(bookingId);

	const reused = await book(owner, body(bookable!), key);
	expect(reused.status).toBe(409);
	expect(extCode(reused)).toBe('idempotency_key_reused');
});

test('EXT-010 reports BOOKED, and the worker writes a pre_registered evacuee', async () => {
	test.setTimeout(150_000);
	test.skip(!bookingId, 'needs the booking from EXT-008');
	const status = await callExt(owner, `/external/bookings/${bookingId}`);
	expect(status.status).toBe(200);
	expect(status.body.result).toMatchObject({
		booking_id: bookingId,
		location_code: bookable,
		booking_status: 'BOOKED'
	});
	expect(status.body.result.persons).toHaveLength(1);
	await eventually('worker wrote the booked evacuee', async () => {
		const docs = await workerDocs(bookable!, bookingId);
		return docs.some((d) => d.current_stay?.status === 'pre_registered');
	});
});

test('a booking is not a residency: EXT-011 is 404 for the booked CID', async () => {
	test.skip(!bookingId, 'needs the booking from EXT-008');
	const res = await callExt(owner, '/external/persons/shelter-residency', {
		query: { ...PURPOSE, cid }
	});
	expect(res.status).toBe(404);
	expect(extCode(res)).toBe('residency_not_found');
});

test('another client can neither read nor cancel the booking', async () => {
	test.skip(!bookingId, 'needs the booking from EXT-008');
	const read = await callExt(writeOnly, `/external/bookings/${bookingId}`);
	const cancel = await callExt(writeOnly, `/external/bookings/${bookingId}/cancel`, {
		method: 'POST'
	});
	expect(read.status).toBe(404);
	expect(extCode(read)).toBe('booking_not_found');
	expect(cancel.status).toBe(404);
	expect(extCode(cancel)).toBe('booking_not_found');
	const mine = await callExt(owner, `/external/bookings/${bookingId}`);
	expect(mine.body.result.booking_status, 'untouched').toBe('BOOKED');
});

test('EXT-009 cancels; a repeat cancel is still 200; EXT-010 says CANCELLED', async () => {
	test.setTimeout(150_000);
	test.skip(!bookingId, 'needs the booking from EXT-008');
	const cancel = await callExt(owner, `/external/bookings/${bookingId}/cancel`, {
		method: 'POST'
	});
	expect(cancel.status, `cancel (code ${extCode(cancel)})`).toBe(200);
	expect(cancel.body.result).toMatchObject({ booking_id: bookingId, booking_status: 'CANCELLED' });
	expect(
		(await callExt(owner, `/external/bookings/${bookingId}/cancel`, { method: 'POST' })).status
	).toBe(200);
	const status = await callExt(owner, `/external/bookings/${bookingId}`);
	expect(status.body.result.booking_status).toBe('CANCELLED');
	await eventually('worker cancelled the evacuee', async () => {
		const docs = await workerDocs(bookable!, bookingId);
		return (
			docs.length > 0 && docs.every((d) => !d.current_stay || d.current_stay.status === 'cancelled')
		);
	});
});

test('a shelter closed to bookings: booking-write alone is 409, booking-bypass books it', async () => {
	test.setTimeout(150_000);
	test.skip(!closed, 'every seeded shelter accepts bookings: no closed one to try');
	const refused = await book(writeOnly, body(closed!));
	expect(refused.status).toBe(409);
	expect(extCode(refused)).toBe('location_not_bookable');

	const forced = await book(bypass, body(closed!));
	expect(forced.status, `bypass (code ${extCode(forced)})`).toBe(201);
	expect(forced.body.result).toMatchObject({ location_code: closed, booking_status: 'BOOKED' });
	const id = forced.body.result.booking_id;
	const cancel = await callExt(bypass, `/external/bookings/${id}/cancel`, { method: 'POST' });
	expect(cancel.status).toBe(200);
});

test('invalid bodies are refused before anything is booked', async () => {
	const code = bookable ?? shelterCodes().a;
	const cases: [string, unknown, number, string][] = [
		['unknown location', body('PERMTEST-NONE'), 404, 'location_not_found'],
		['CID too short', body(code, '123'), 422, 'validation_error'],
		['no persons', { location_code: code, persons: [] }, 422, 'validation_error'],
		['no location', { persons: body(code).persons }, 422, 'validation_error']
	];
	for (const [label, payload, status, code_] of cases) {
		const res = await book(owner, payload);
		expect(res.status, `${label} (code ${extCode(res)})`).toBe(status);
		expect(extCode(res), label).toBe(code_);
	}
});
