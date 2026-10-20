/**
 * Partner API (EXT-001…011, ADR 0002) — end to end through the real `/external/*` plane.
 *
 * `@smoke` (no data created, any target): every endpoint refuses a missing / garbage token with
 * 401 `invalid_token`, and `/external/token` rejects bad grants.
 *
 * `@critical` (local, or staging with `ALLOW_REMOTE_WRITES=true`): the run provisions its own
 * `E2E partner …` shelter and partner client through the staff UI (System management → API
 * Keys), then
 *   - A1/A2  creates a client with all six scopes and mints a token for it,
 *   - A3     walks every EXT endpoint's happy path (booking create / idempotency / cancel),
 *   - A3b    proves one client cannot read or cancel another client's booking,
 *   - A4     scope matrix: removes each scope in turn via the BFF and asserts every endpoint
 *            that needs it answers 403 `insufficient_scope` while the rest keep working,
 *   - A5     least privilege (`location-read` only),
 *   - A6-A8  edit scopes / revoke / delete through the UI.
 *
 * Current token behaviour is asserted on purpose (ADR 0002 §6): `verify_thirdparty_token`
 * trusts the JWT claims and never reads the DB, so a token minted before a scope removal or a
 * revoke keeps working until it expires (3,600 s). Only a token minted afterwards reflects the
 * change. A6/A7 pin that, the dialogs themselves say so.
 *
 * Everything created is written to a ledger first; the Z test and afterAll tear it down (cancel
 * bookings → shelter → revoke + delete clients). PII-free rows that stay in Mongo are swept by
 * the partner janitor (README §9.C). Local stack: `docker compose up -d` (CouchDB, Mongo, worker,
 * FastAPI :9000) and the preview server must carry `FASTAPI_INTERNAL_URL` + `EXTERNAL_API_SECRET`.
 */
import {
	expect,
	test,
	type APIRequestContext,
	type BrowserContext,
	type Page
} from '@playwright/test';
import {
	SCOPE_LABEL,
	type ThirdPartyClient
} from '../src/lib/features/third-party-clients/domain/third-party-client';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	PARTNER_ENDPOINTS,
	PARTNER_SCOPES,
	PartnerAdmin,
	PartnerLedger,
	bookingBody,
	callExt,
	callExtPath,
	expectExtError,
	expectPartnerRunGone,
	freshCid,
	mintToken,
	partnerApiUrl,
	postToken,
	teardownPartnerRun,
	type CallOptions,
	type ExtCtx,
	type ExtResponse,
	type PartnerEndpoint,
	type PartnerScope
} from './helpers/partner-api';
import {
	publicSearchHits,
	publicShelter,
	waitForProjection,
	type PublicSearchHit
} from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

const API_KEYS_PATH = '/system-management/api-keys';
const CLIENT_NAME = `E2E partner ${RUN_ID}`;
const ISOLATION_CLIENT_NAME = `E2E partner-iso ${RUN_ID}`;
const SHELTER_NAME = `E2E partner ${RUN_ID}`;

/**
 * Per the contract only the summary's top-level `occupancy_total` needs `occupancy-read`; each
 * location row carries its own `occupancy_total` under `location-read` alone (intended, not a leak).
 */
function expectPerLocationOccupancy(
	result: { locations?: { location_code: string; occupancy_total?: unknown }[] },
	code: string
): void {
	const row = result.locations?.find((l) => l.location_code === code);
	expect(row, `summary lists ${code}`).toBeDefined();
	expect(typeof row?.occupancy_total).toBe('number');
}

const byExt = (ext: string): PartnerEndpoint => {
	const endpoint = PARTNER_ENDPOINTS.find((e) => e.ext === ext);
	if (!endpoint) throw new Error(`unknown endpoint ${ext}`);
	return endpoint;
};

// ─── @smoke — no data, any target ──────────────────────────────────────────────

test.describe('Partner API auth gate', { tag: ['@partner-api', '@smoke'] }, () => {
	test.describe.configure({ mode: 'serial' });

	test('S1 every EXT endpoint refuses a missing or garbage token with 401 + WWW-Authenticate: Bearer', async ({
		request
	}) => {
		const ctx: ExtCtx = { code: 'SH000', bookingId: 'bk_e2e_none', cid: freshCid() };
		for (const endpoint of PARTNER_ENDPOINTS) {
			const none = await callExt(request, null, endpoint, ctx);
			expectExtError(none, 401, 'invalid_token', `${endpoint.ext} without a token`);
			expect(none.headers['www-authenticate'], `${endpoint.ext} without a token: challenge`).toBe(
				'Bearer'
			);
			const garbage = await callExt(request, 'not.a.jwt', endpoint, ctx);
			expectExtError(garbage, 401, 'invalid_token', `${endpoint.ext} with a garbage token`);
			expect(
				garbage.headers['www-authenticate'],
				`${endpoint.ext} with a garbage token: challenge`
			).toBe('Bearer');
		}
	});

	test('S2 /external/token rejects bad grants', async ({ request }) => {
		const wrongGrant = await postToken(request, {
			grant_type: 'password',
			client_id: 'tpc_e2e_none',
			client_secret: 'e2e-none'
		});
		expectExtError(wrongGrant, 400, 'unsupported_grant_type');

		const unknownClient = await postToken(request, {
			grant_type: 'client_credentials',
			client_id: 'tpc_e2e_does_not_exist',
			client_secret: 'e2e-none'
		});
		expectExtError(unknownClient, 401, 'invalid_client');

		// OAuth2 clients usually send application/x-www-form-urlencoded; this endpoint is JSON-only.
		const form = await request.post(`${partnerApiUrl()}/external/token`, {
			form: {
				grant_type: 'client_credentials',
				client_id: 'tpc_e2e_none',
				client_secret: 'e2e-none'
			},
			failOnStatusCode: false
		});
		expect(form.status()).toBe(422);
	});
});

// ─── @critical — own shelter + own partner clients ─────────────────────────────

/** Run-wide state; serial mode shares it across tests (a failure skips the rest). */
interface Run {
	page: Page;
	api: APIRequestContext;
	admin: PartnerAdmin;
	code: string;
	clientRowId: string;
	clientId: string;
	/** In memory only — never written to the ledger, logs or reports. */
	secret: string;
	token: string;
	bookingId: string;
	cid: string;
}

const ledger = new PartnerLedger();
const secrets = new Map<string, string>();
let run: Run | undefined;
/** Held apart from `run` so afterAll closes them even when beforeAll died before `run` was set. */
let browserContext: BrowserContext | undefined;
let apiContext: APIRequestContext | undefined;

function state(): Run {
	if (!run) throw new Error('partner-api run was not set up (beforeAll failed?)');
	return run;
}

const ctxOf = (r: Run): ExtCtx => ({ code: r.code, bookingId: r.bookingId, cid: r.cid });

/** Mint a token for the main client with its current scopes (cheap: no rate limit). */
async function mintMain(r: Run) {
	return mintToken(r.api, r.clientId, r.secret);
}

/**
 * Call an endpoint. An EXT-008 create is ledgered BEFORE the request (client + idempotency key +
 * body), so a lost response still leaves teardown a way to recover and cancel the booking; the
 * entry is resolved on 201 and dropped when the call was answered without creating anything.
 */
async function call(
	r: Run,
	token: string,
	endpoint: PartnerEndpoint,
	ctx: ExtCtx = ctxOf(r),
	options: CallOptions = {}
): Promise<ExtResponse> {
	if (endpoint.ext !== 'EXT-008') return callExt(r.api, token, endpoint, ctx, options);
	const key = options.headers?.['Idempotency-Key'] ?? `e2e-${RUN_ID}-${freshCid()}`;
	const body = options.body ?? endpoint.body?.(ctx);
	// One intent per call: a replay shares the key but is ledgered (and dropped) on its own.
	const intent = `${key}#${freshCid()}`;
	ledger.add('bookings', {
		bookingId: '',
		clientId: r.clientId,
		intent,
		idempotencyKey: key,
		body
	});
	const res = await callExt(r.api, token, endpoint, ctx, {
		...options,
		body,
		headers: { ...options.headers, 'Idempotency-Key': key }
	});
	if (res.status === 201) ledger.resolveBooking(intent, res.body.result.booking_id);
	else ledger.dropBookingIntent(intent);
	return res;
}

/** Row of the API Keys list for `clientId` (client ids are unique, names are not). */
const clientRow = (page: Page, clientId: string) => page.locator('tr', { hasText: clientId });

async function openApiKeys(page: Page) {
	await page.goto(API_KEYS_PATH);
	await expect(page.getByRole('button', { name: 'Create client' }).first()).toBeVisible({
		timeout: 30_000
	});
}

/**
 * Wait for the sync worker to write the booking's evacuee into the shelter DB (the API only
 * reports BOOKED / CANCELLED / REJECTED — the worker step is only visible in CouchDB).
 */
async function waitForWorkerWrite(
	code: string,
	bookingId: string,
	stay: 'pre_registered' | 'cancelled' = 'pre_registered'
) {
	await waitForProjection(
		`worker wrote booking ${bookingId} as ${stay}`,
		async () => {
			const res = await couchReq('POST', `/shelter_${code.toLowerCase()}/_find`, {
				selector: { type: 'evacuee', booking_ref: bookingId },
				limit: 5
			});
			const docs = (res.data as { docs?: { current_stay?: { status?: string } }[] })?.docs ?? [];
			return docs.length > 0 && docs.every((d) => d.current_stay?.status === stay);
		},
		{ timeoutMs: 90_000, intervalMs: 3_000 }
	);
}

/** Response of a fully scoped endpoint: 200 / 201 / 404 residency_not_found per the table. */
function expectScopePassed(res: ExtResponse, endpoint: PartnerEndpoint) {
	if (endpoint.ext === 'EXT-011') {
		expectExtError(res, 404, 'residency_not_found', endpoint.ext);
	} else {
		expect(res.status, `${endpoint.ext} (code ${res.body?.code})`).toBe(endpoint.okStatus);
	}
}

/** A fully scoped token's view of every endpoint that does NOT need `denied` (no side effects). */
async function expectOthersStillWork(r: Run, token: string, denied: readonly PartnerScope[]) {
	for (const endpoint of PARTNER_ENDPOINTS) {
		// EXT-008 would create a booking just to prove the gate stays open — covered by A3.
		if (denied.includes(endpoint.scope) || endpoint.ext === 'EXT-008') continue;
		// Fresh CID for every probe so none depends on the state of the run's own booking.
		const res = await call(r, token, endpoint, { ...ctxOf(r), cid: freshCid() });
		expectScopePassed(res, endpoint);
	}
}

test.describe('Partner API', { tag: ['@partner-api', '@critical'] }, () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
	});

	test.beforeAll(async ({ browser, playwright }) => {
		test.setTimeout(240_000);
		if (!CAN_WRITE) return;
		const api = await playwright.request.newContext();
		apiContext = api;
		const admin = new PartnerAdmin(api);
		// Leftovers of a crashed earlier run (ledger-only, never a search).
		await teardownPartnerRun(api, admin, ledger);

		const session = await bootstrapAdminSession();
		const context = await browser.newContext();
		browserContext = context;
		const page = await context.newPage();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, session.user, session.cookie);

		const code = await createShelterViaUi(page, {
			name: SHELTER_NAME,
			siteKind: 'evacuation_center',
			lat: 7.012,
			lng: 100.5,
			subdistrict: 'คอหงส์',
			capacity: 40,
			acceptsPreRegistration: true
		});
		ledger.add('shelters', code);
		await waitForProjection(
			`${code} open on the public plane`,
			async () => (await publicShelter(code))?.status === 'open',
			{ timeoutMs: 60_000, intervalMs: 2_000 }
		);
		run = {
			page,
			api,
			admin,
			code,
			clientRowId: '',
			clientId: '',
			secret: '',
			token: '',
			bookingId: 'bk_e2e_not_booked_yet',
			cid: freshCid()
		};
	});

	test.afterAll(async ({ playwright }) => {
		test.setTimeout(240_000);
		if (!CAN_WRITE) return;
		// If beforeAll died half-way `run` is unset, but the ledger still names what to remove.
		const api = apiContext ?? (await playwright.request.newContext());
		try {
			await teardownPartnerRun(api, run?.admin ?? new PartnerAdmin(api), ledger, secrets);
		} finally {
			secrets.clear();
			await browserContext?.close();
			await api.dispose();
			run = undefined;
			browserContext = undefined;
			apiContext = undefined;
		}
	});

	test('A1 UI: create a client with all six scopes', async () => {
		test.setTimeout(120_000);
		const r = state();
		const { page } = r;
		await openApiKeys(page);
		// Name first: if the run dies before the id is known, teardown still finds this client.
		ledger.add('clientNames', CLIENT_NAME);

		await page.getByRole('button', { name: 'Create client' }).first().click();
		const form = page.getByRole('dialog');
		await form.locator('#tpc-name').fill(CLIENT_NAME);
		for (const scope of PARTNER_SCOPES) {
			await form.getByRole('checkbox', { name: SCOPE_LABEL[scope], exact: true }).check();
		}
		await form.getByRole('button', { name: 'Create client' }).click();

		const reveal = page.getByRole('dialog').filter({ hasText: 'Copy the client credentials' });
		await expect(reveal).toBeVisible();
		const values = reveal.locator('span.select-all');
		let clientId: string;
		let secret: string;
		try {
			clientId = (await values.nth(0).innerText()).trim();
			secret = (await values.nth(1).innerText()).trim();
		} finally {
			// Close the dialog before any assertion, even when reading failed: a failure screenshot /
			// video / error-context snapshot must never capture the secret (kept in memory only).
			await reveal.getByRole('button', { name: 'Done' }).click({ timeout: 10_000 });
		}
		await expect(reveal).toBeHidden();
		secrets.set(clientId, secret);
		// Ledger the client as soon as its id is known — before any other assertion can fail. The BFF
		// list can lag the create by a moment, so poll instead of skipping the ledger on a miss.
		let created: ThirdPartyClient | undefined;
		await expect
			.poll(
				async () => {
					created = (await r.admin.listClients()).find((c) => c.client_id === clientId);
					return Boolean(created);
				},
				{ message: 'created client is listed by the BFF', timeout: 30_000 }
			)
			.toBe(true);
		ledger.add('clients', { rowId: created!.id, clientId });
		expect(clientId).toMatch(/^tpc_/);
		expect(secret.length, 'client secret shown').toBeGreaterThan(16);
		r.clientRowId = created!.id;
		r.clientId = clientId;
		r.secret = secret;

		const row = clientRow(page, clientId);
		await expect(row).toBeVisible();
		await expect(row).toContainText(CLIENT_NAME);
		await expect(row.getByText('Active', { exact: true })).toBeVisible();
		for (const scope of PARTNER_SCOPES)
			await expect(row.getByText(scope, { exact: true })).toBeVisible();
		expect(created!.allowed_scopes.slice().sort()).toEqual([...PARTNER_SCOPES].sort());
	});

	test('A2 mint a token: exactly the six scopes, Bearer, positive expiry', async () => {
		const r = state();
		const minted = await mintMain(r);
		expect(minted.token_type).toBe('Bearer');
		expect(minted.expires_in).toBeGreaterThan(0);
		expect(minted.scopes.slice().sort()).toEqual([...PARTNER_SCOPES].sort());
		// Shape only, as a boolean: a failing assertion must never echo the bearer token.
		expect(
			/^[\w-]+\.[\w-]+\.[\w-]+$/.test(minted.access_token),
			'minted access_token is a three-part JWT (value withheld)'
		).toBe(true);
		r.token = minted.access_token;
	});

	test('A3 EXT-002/003 location master lists and reads the run shelter', async () => {
		test.setTimeout(120_000);
		const r = state();
		// The shelter reaches the partner plane through the same projection as the public one.
		await expect
			.poll(async () => (await call(r, r.token, byExt('EXT-003'))).status, {
				timeout: 60_000,
				intervals: [2_000, 3_000]
			})
			.toBe(200);
		const detail = await call(r, r.token, byExt('EXT-003'));
		expect(detail.body.result.location_code).toBe(r.code);
		expect(detail.body.result.name_th).toBe(SHELTER_NAME);

		let found = false;
		for (let page = 1; page <= 20 && !found; page++) {
			const res = await callExtPath(r.api, r.token, 'GET', '/external/locations', {
				query: { limit: '200', page: String(page) }
			});
			expect(res.status).toBe(200);
			const rows = res.body.result as { location_code: string }[];
			found = rows.some((l) => l.location_code === r.code);
			if (rows.length < 200) break;
		}
		expect(found, `EXT-002 lists ${r.code}`).toBe(true);
	});

	test('A3 EXT-004/005/006 stock, occupancy and summary', async () => {
		const r = state();
		expect((await call(r, r.token, byExt('EXT-004'))).status).toBe(200);
		expect((await call(r, r.token, byExt('EXT-005'))).status).toBe(200);
		const summary = await call(r, r.token, byExt('EXT-006'));
		expect(summary.status).toBe(200);
		// Held `occupancy-read`, so the cross-location total is a number, not null.
		expect(summary.body.result.occupancy_total).not.toBeNull();
	});

	test('A3 EXT-007 occupants carry a purpose and expose no PII fields', async () => {
		const r = state();
		const res = await call(r, r.token, byExt('EXT-007'));
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body.result)).toBe(true);
		const pii = ['cid', 'national_id', 'first_name', 'last_name', 'phone', 'address', 'name'];
		for (const item of res.body.result as Record<string, unknown>[]) {
			for (const key of pii) expect(item, `occupant item has no "${key}"`).not.toHaveProperty(key);
		}
		// Purpose is mandatory (checked before scope).
		const noPurpose = await callExtPath(r.api, r.token, 'GET', byExt('EXT-007').path(ctxOf(r)));
		expectExtError(noPurpose, 400, 'missing_purpose');
	});

	test('A3 EXT-008 booking: create, idempotent replay, key reuse', async () => {
		test.setTimeout(120_000);
		const r = state();
		const key = `e2e-${RUN_ID}`;
		const body = bookingBody(r.code, r.cid);

		const created = await call(r, r.token, byExt('EXT-008'), ctxOf(r), {
			headers: { 'Idempotency-Key': key },
			body
		});
		expect(created.status, `EXT-008 create (code ${created.body?.code})`).toBe(201);
		expect(created.body.result).toMatchObject({
			location_code: r.code,
			booking_status: 'BOOKED',
			persons_count: 1
		});
		r.bookingId = created.body.result.booking_id as string;
		expect(r.bookingId).toBeTruthy();

		// Same key + same body replays the original 201 (no second booking is created).
		const replay = await call(r, r.token, byExt('EXT-008'), ctxOf(r), {
			headers: { 'Idempotency-Key': key },
			body
		});
		expect(replay.status, `replay (code ${replay.body?.code})`).toBe(201);
		expect(replay.body.result.booking_id).toBe(r.bookingId);

		// Same key + different body is refused.
		const reused = await call(r, r.token, byExt('EXT-008'), ctxOf(r), {
			headers: { 'Idempotency-Key': key },
			body: bookingBody(r.code)
		});
		expectExtError(reused, 409, 'idempotency_key_reused');
	});

	test('A3 EXT-010 booking status, until the worker wrote it', async () => {
		test.setTimeout(150_000);
		const r = state();
		const res = await call(r, r.token, byExt('EXT-010'));
		expect(res.status).toBe(200);
		expect(res.body.result).toMatchObject({
			booking_id: r.bookingId,
			location_code: r.code,
			booking_status: 'BOOKED'
		});
		expect(res.body.result.persons).toHaveLength(1);
		// poll: sync worker (3 s tick) turns the Mongo row into a CouchDB household + evacuee.
		await waitForWorkerWrite(r.code, r.bookingId);
		const after = await call(r, r.token, byExt('EXT-010'));
		expect(after.body.result.booking_status).toBe('BOOKED');
	});

	test('A3 EXT-011 residency of the booked CID is not found (nobody checked in)', async () => {
		const r = state();
		expectExtError(await call(r, r.token, byExt('EXT-011')), 404, 'residency_not_found');
		// purpose is mandatory here too, and ahead of the scope check.
		const noPurpose = await callExtPath(
			r.api,
			r.token,
			'GET',
			'/external/persons/shelter-residency',
			{
				query: { cid: r.cid }
			}
		);
		expectExtError(noPurpose, 400, 'missing_purpose');
	});

	test('A3 EXT-009 cancel, repeat cancel, then EXT-010 reports CANCELLED', async () => {
		test.setTimeout(150_000);
		const r = state();
		const cancel = await call(r, r.token, byExt('EXT-009'));
		expect(cancel.status, `cancel (code ${cancel.body?.code})`).toBe(200);
		expect(cancel.body.result).toMatchObject({
			booking_id: r.bookingId,
			booking_status: 'CANCELLED'
		});
		// A repeat of a cancel that already happened is still 200 (CR-169 FR-40).
		expect((await call(r, r.token, byExt('EXT-009'))).status).toBe(200);

		const status = await call(r, r.token, byExt('EXT-010'));
		expect(status.status).toBe(200);
		expect(status.body.result.booking_status).toBe('CANCELLED');
		// Let the worker apply the cancel before the shelter DB is torn down at the end.
		await waitForWorkerWrite(r.code, r.bookingId, 'cancelled');
	});

	test('A3b another client cannot read or cancel this client’s booking', async () => {
		const r = state();
		ledger.add('clientNames', ISOLATION_CLIENT_NAME);
		const other = await r.admin.createClient(ISOLATION_CLIENT_NAME, ['booking-write'], (c) =>
			ledger.add('clients', { rowId: c.id, clientId: c.client_id })
		);
		secrets.set(other.client_id, other.client_secret);
		const otherToken = (await mintToken(r.api, other.client_id, other.client_secret)).access_token;

		expectExtError(
			await callExt(r.api, otherToken, byExt('EXT-010'), ctxOf(r)),
			404,
			'booking_not_found'
		);
		expectExtError(
			await callExt(r.api, otherToken, byExt('EXT-009'), ctxOf(r)),
			404,
			'booking_not_found'
		);
		// ...and the owner's booking is untouched.
		const mine = await call(r, r.token, byExt('EXT-010'));
		expect(mine.body.result.booking_status).toBe('CANCELLED');
	});

	test('EXT-011 does not report a cancelled, never-checked-in booking as residency', async () => {
		// A cancelled stay has no Station 1 check-in behind it: 404, like before the cancel (#710, CR-176).
		test.setTimeout(120_000);
		const r = state();
		// Precondition (fails loudly when run alone or reordered): this run's booking is cancelled.
		expect(r.bookingId, 'needs the booking created and cancelled by A3').not.toBe(
			'bk_e2e_not_booked_yet'
		);
		const status = await call(r, r.token, byExt('EXT-010'));
		expect(status.body.result.booking_status).toBe('CANCELLED');

		// EXT-011 reads the Mongo `public_persons` projection, which lags the CouchDB write that
		// `waitForWorkerWrite` sees. Wait until public search (same projection) shows the cancelled
		// stay; before that the row is still `pre_registered` and a 404 would prove nothing.
		let hits: PublicSearchHit[] = [];
		await waitForProjection(
			`cancelled stay of ${r.cid} on the public plane`,
			async () => {
				hits = await publicSearchHits(r.cid);
				return hits.some((h) => h.status === 'cancelled');
			},
			{ timeoutMs: 60_000, intervalMs: 3_000 }
		);
		// The root of #710: the projector used to stamp the cancel time as `checked_in_at`.
		for (const hit of hits.filter((h) => h.status === 'cancelled')) {
			expect(hit.checked_in_at, 'cancelled stay carries no check-in time').toBeNull();
		}
		expectExtError(await call(r, r.token, byExt('EXT-011')), 404, 'residency_not_found');
	});

	test('A4 scope matrix: removing each scope closes exactly its endpoints', async () => {
		test.setTimeout(240_000);
		const r = state();
		for (const scope of PARTNER_SCOPES) {
			await test.step(`without ${scope}`, async () => {
				const remaining = PARTNER_SCOPES.filter((s) => s !== scope);
				await r.admin.patchScopes(r.clientRowId, remaining);
				const minted = await mintMain(r);
				expect(minted.scopes, `token minted without ${scope}`).not.toContain(scope);
				expect(minted.scopes.slice().sort()).toEqual([...remaining].sort());

				for (const endpoint of PARTNER_ENDPOINTS.filter((e) => e.scope === scope)) {
					// A fresh CID per attempt: if the gate failed, the booking would be real.
					const res = await call(r, minted.access_token, endpoint, {
						...ctxOf(r),
						cid: freshCid()
					});
					expectExtError(res, 403, 'insufficient_scope', `${endpoint.ext} without ${scope}`);
				}
				if (scope === 'occupancy-read') {
					// EXT-006 is gated on location-read: it stays 200 but hides the occupancy total.
					const summary = await call(r, minted.access_token, byExt('EXT-006'));
					expect(summary.status).toBe(200);
					expect(summary.body.result.occupancy_total).toBeNull();
					expectPerLocationOccupancy(summary.body.result, r.code);
				}
				// The token itself is fine: every endpoint on another scope still answers.
				await expectOthersStillWork(r, minted.access_token, [scope]);
			});
		}
		await r.admin.patchScopes(r.clientRowId, PARTNER_SCOPES);
		expect((await mintMain(r)).scopes.slice().sort()).toEqual([...PARTNER_SCOPES].sort());
	});

	test('A5 least privilege: location-read alone opens only its endpoints', async () => {
		test.setTimeout(120_000);
		const r = state();
		await r.admin.patchScopes(r.clientRowId, ['location-read']);
		const { access_token, scopes } = await mintMain(r);
		expect(scopes).toEqual(['location-read']);
		for (const endpoint of PARTNER_ENDPOINTS) {
			const res = await call(r, access_token, endpoint, { ...ctxOf(r), cid: freshCid() });
			if (endpoint.scope === 'location-read') {
				expect(res.status, `${endpoint.ext} keeps working`).toBe(200);
			} else {
				expectExtError(res, 403, 'insufficient_scope', endpoint.ext);
			}
		}
		const summary = await call(r, access_token, byExt('EXT-006'));
		expect(summary.body.result.occupancy_total).toBeNull();
		expectPerLocationOccupancy(summary.body.result, r.code);
		await r.admin.patchScopes(r.clientRowId, PARTNER_SCOPES);
	});

	test('A6 UI: removing booking-write only affects tokens minted afterwards', async () => {
		test.setTimeout(120_000);
		const r = state();
		const tOld = (await mintMain(r)).access_token;
		expect((await call(r, tOld, byExt('EXT-010'))).status).toBe(200);

		await openApiKeys(r.page);
		await clientRow(r.page, r.clientId).getByRole('button', { name: 'Edit scopes' }).click();
		const dialog = r.page.getByRole('dialog').filter({ hasText: 'Edit scopes' });
		await expect(dialog).toBeVisible();
		await dialog
			.getByRole('checkbox', { name: SCOPE_LABEL['booking-write'], exact: true })
			.uncheck();
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(r.page.getByText('Scopes updated')).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(
			clientRow(r.page, r.clientId).getByText('booking-write', { exact: true })
		).toHaveCount(0);

		const fresh = await mintMain(r);
		expect(fresh.scopes).not.toContain('booking-write');
		expectExtError(await call(r, fresh.access_token, byExt('EXT-010')), 403, 'insufficient_scope');

		// Intended (ADR 0002 §6; the dialog: "Tokens already issued keep their old scopes until
		// they expire"): the JWT is trusted without a DB lookup, so T_old still works.
		expect((await call(r, tOld, byExt('EXT-010'))).status).toBe(200);
	});

	test('A7 UI: revoke blocks new tokens, an already issued one lives on', async () => {
		test.setTimeout(120_000);
		const r = state();
		const tOld = (await mintMain(r)).access_token;

		await openApiKeys(r.page);
		await clientRow(r.page, r.clientId).getByRole('button', { name: 'Revoke' }).click();
		await r.page.getByRole('alertdialog').getByRole('button', { name: 'Revoke client' }).click();
		await expect(r.page.getByText('Third-party client revoked')).toBeVisible();
		const row = clientRow(r.page, r.clientId);
		await expect(row.getByText('Revoked', { exact: true })).toBeVisible();

		expectExtError(
			await postToken(r.api, {
				grant_type: 'client_credentials',
				client_id: r.clientId,
				client_secret: r.secret
			}),
			401,
			'invalid_client'
		);
		// Intended (ADR 0002 §6; the dialog: "Any token already issued stays valid until it
		// naturally expires (up to 3,600s later)"): revoke stops minting, not live tokens.
		expect((await callExtPath(r.api, tOld, 'GET', '/external/locations')).status).toBe(200);
	});

	test('A8 UI: delete removes the revoked client from the list', async () => {
		test.setTimeout(120_000);
		const r = state();
		await openApiKeys(r.page);
		await clientRow(r.page, r.clientId).getByRole('button', { name: 'Delete' }).click();
		await r.page.getByRole('alertdialog').getByRole('button', { name: 'Delete client' }).click();
		await expect(r.page.getByText('Third-party client deleted')).toBeVisible();
		await expect(clientRow(r.page, r.clientId)).toHaveCount(0);
		const rows: ThirdPartyClient[] = await r.admin.listClients();
		expect(rows.some((c) => c.id === r.clientRowId)).toBe(false);
	});

	test('Z teardown leaves no shelter, client or open booking from this run', async () => {
		test.setTimeout(240_000);
		const r = state();
		const done = await teardownPartnerRun(r.api, r.admin, ledger, secrets);
		expect(done.shelters).toEqual([r.code]);
		expect(done.clients.length).toBeGreaterThanOrEqual(2);
		await expectPartnerRunGone(r.admin, done);
		expect(ledger.read()).toEqual({ clients: [], clientNames: [], shelters: [], bookings: [] });
	});
});
