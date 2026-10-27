/**
 * Partner API (EXT-001…012, ADR 0002) — end to end through the real `/external/*` plane.
 *
 * `@smoke` (no data created, any target): every endpoint refuses a missing / garbage token with
 * 401 `invalid_token`, and `/external/token` rejects bad grants.
 *
 * `@critical` (local, or staging with `ALLOW_REMOTE_WRITES=true`): the run provisions its own
 * `E2E partner …` shelter and partner client through the staff UI (System management → API
 * Keys), then
 *   - A1/A2  creates a client with all eight scopes and mints a token for it,
 *   - A3     walks every EXT endpoint's happy path (booking create / idempotency / cancel),
 *   - B1/B2  `accepts_booking` (#751) on EXT-003 / EXT-002 (+ the `?accepts_booking=` filter), for the
 *            run's bookable shelter and a second `E2E partner closed …` shelter that is not,
 *   - A3b    proves one client cannot read or cancel another client's booking,
 *   - B3/B4  EXT-008 on the not-bookable shelter: `booking-write` alone is 409 `location_not_bookable`,
 *            with `booking-bypass` (EOC) it is booked (201 → BOOKED → cancelled),
 *   - E12-1…5 EXT-012 person search (#736): masked hit, no-store, purpose, validation, cancelled dropped,
 *   - A4     scope matrix: removes each scope in turn via the BFF and asserts every endpoint
 *            that needs it answers 403 `insufficient_scope` while the rest keep working; a scope
 *            with no endpoint of its own (`booking-bypass`) is checked by its probe instead,
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
	createLedgeredClient,
	expectExtError,
	expectPartnerRunGone,
	freshCid,
	listAllLocations,
	mintToken,
	partnerApiUrl,
	postToken,
	SCOPE_PROBES,
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
const BYPASS_CLIENT_NAME = `E2E partner-bypass ${RUN_ID}`;
const SHELTER_NAME = `E2E partner ${RUN_ID}`;
/** Second shelter: pre-registration switch OFF, so it is not bookable by the normal rule. */
const CLOSED_SHELTER_NAME = `E2E partner closed ${RUN_ID}`;

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
	/** Second shelter, pre-registration off: not bookable by the normal rule (#751). */
	closedCode: string;
	/** Set by A3b: a `booking-write`-only client (no `booking-bypass`). */
	writeOnly?: { clientId: string; token: string };
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
/** Context aimed at the not-bookable shelter, with a fresh CID per use. */
const closedCtxOf = (r: Run): ExtCtx => ({ ...ctxOf(r), code: r.closedCode, cid: freshCid() });

/** Mint a token for the main client with its current scopes (cheap: no rate limit). */
async function mintMain(r: Run) {
	return mintToken(r.api, r.clientId, r.secret);
}

/**
 * Call an endpoint. An EXT-008 create is ledgered BEFORE the request (client + idempotency key +
 * body), so a lost response still leaves teardown a way to recover and cancel the booking; the
 * entry is resolved on 201 and dropped when the call was answered without creating anything.
 * `ownerClientId` is the client `token` belongs to (the main client unless another one books).
 */
async function call(
	r: Run,
	token: string,
	endpoint: PartnerEndpoint,
	ctx: ExtCtx = ctxOf(r),
	options: CallOptions = {},
	ownerClientId: string = r.clientId
): Promise<ExtResponse> {
	if (endpoint.ext !== 'EXT-008') return callExt(r.api, token, endpoint, ctx, options);
	const key = options.headers?.['Idempotency-Key'] ?? `e2e-${RUN_ID}-${freshCid()}`;
	const body = options.body ?? endpoint.body?.(ctx);
	// One intent per call: a replay shares the key but is ledgered (and dropped) on its own.
	const intent = `${key}#${freshCid()}`;
	ledger.add('bookings', {
		bookingId: '',
		clientId: ownerClientId,
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

/**
 * EXT-008 aimed at the shelter that is closed to bookings, ledgered like any other create.
 * `ownerClientId` is the client `token` belongs to; `ctx` carries the CID (fresh by default).
 */
const bookClosedShelter = (
	r: Run,
	token: string,
	ownerClientId: string,
	ctx: ExtCtx = closedCtxOf(r)
): Promise<ExtResponse> =>
	call(
		r,
		token,
		byExt('EXT-008'),
		ctx,
		{ body: bookingBody(r.closedCode, ctx.cid) },
		ownerClientId
	);

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

/**
 * EXT-012 reads the Mongo `public_persons` projection, which lags the CouchDB write that
 * `waitForWorkerWrite` sees. Wait until public search (same projection) shows the stay as `stay`;
 * before that an EXT-012 assertion would prove nothing.
 */
async function waitForProjectedStay(cid: string, stay: 'pre_registered' | 'cancelled') {
	await waitForProjection(
		`${stay} stay of ${cid} on the public plane`,
		async () => (await publicSearchHits(cid)).some((h) => h.status === stay),
		{ timeoutMs: 60_000, intervalMs: 3_000 }
	);
}

/** Response of a fully scoped endpoint: 200 / 201 / 404 residency_not_found per the table. */
function expectScopePassed(res: ExtResponse, endpoint: PartnerEndpoint) {
	if (endpoint.ext === 'EXT-011') {
		expectExtError(res, 404, 'residency_not_found', endpoint.ext);
	} else if (endpoint.ext === 'EXT-012') {
		// A fresh CID nobody is registered under: the gate is open and the search finds no one.
		expect(res.status, `${endpoint.ext} (code ${res.body?.code})`).toBe(200);
		expect(res.body?.result, `${endpoint.ext} finds nobody`).toEqual([]);
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
		test.setTimeout(360_000);
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
		// Same shelter with the pre-registration switch left off: not bookable by the normal rule.
		const closedCode = await createShelterViaUi(page, {
			name: CLOSED_SHELTER_NAME,
			siteKind: 'evacuation_center',
			lat: 7.013,
			lng: 100.51,
			subdistrict: 'คอหงส์',
			capacity: 40
		});
		ledger.add('shelters', closedCode);
		for (const shelter of [code, closedCode]) {
			await waitForProjection(
				`${shelter} open on the public plane`,
				async () => (await publicShelter(shelter))?.status === 'open',
				{ timeoutMs: 60_000, intervalMs: 2_000 }
			);
		}
		run = {
			page,
			api,
			admin,
			code,
			closedCode,
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

	test('A1 UI: create a client with all eight scopes', async () => {
		test.setTimeout(120_000);
		const r = state();
		const { page } = r;
		// #751: `booking-bypass` joins the seven scopes of ADR 0002 and is ticked like the rest.
		expect(PARTNER_SCOPES as readonly string[]).toContain('booking-bypass');
		expect(PARTNER_SCOPES).toHaveLength(8);
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

	test('A2 mint a token: exactly the eight scopes, Bearer, positive expiry', async () => {
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

		const all = await listAllLocations(r.api, r.token);
		expect(
			all.some((l) => l.location_code === r.code),
			`EXT-002 lists ${r.code}`
		).toBe(true);
	});

	test('B1 EXT-003 accepts_booking: true for the bookable shelter, false for the closed one', async () => {
		test.setTimeout(120_000);
		const r = state();
		const closed = closedCtxOf(r);
		// The second shelter reaches the partner plane through the same projection as the first.
		await expect
			.poll(async () => (await call(r, r.token, byExt('EXT-003'), closed)).status, {
				timeout: 60_000,
				intervals: [2_000, 3_000]
			})
			.toBe(200);
		const bookable = await call(r, r.token, byExt('EXT-003'));
		expect(bookable.body.result.location_code).toBe(r.code);
		expect(bookable.body.result.accepts_booking, `${r.code} accepts bookings`).toBe(true);
		const notBookable = await call(r, r.token, byExt('EXT-003'), closed);
		expect(notBookable.body.result.location_code).toBe(r.closedCode);
		expect(notBookable.body.result.accepts_booking, `${r.closedCode} does not`).toBe(false);
	});

	test('B2 EXT-002 ?accepts_booking=true|false filters, and every row carries the field', async () => {
		test.setTimeout(120_000);
		const r = state();
		const closed = closedCtxOf(r);
		// Self-sufficient (does not rely on B1 having run): wait for the closed shelter's projection.
		await expect
			.poll(async () => (await call(r, r.token, byExt('EXT-003'), closed)).status, {
				timeout: 60_000,
				intervals: [2_000, 3_000]
			})
			.toBe(200);
		const yes = await listAllLocations(r.api, r.token, { accepts_booking: 'true' });
		expect(yes.map((l) => l.location_code)).toContain(r.code);
		expect(yes.map((l) => l.location_code)).not.toContain(r.closedCode);
		for (const row of yes) expect(row.accepts_booking, `${row.location_code} in true`).toBe(true);

		const no = await listAllLocations(r.api, r.token, { accepts_booking: 'false' });
		expect(no.map((l) => l.location_code)).toContain(r.closedCode);
		expect(no.map((l) => l.location_code)).not.toContain(r.code);
		for (const row of no) expect(row.accepts_booking, `${row.location_code} in false`).toBe(false);

		// Unfiltered rows carry the field too, and it agrees with the filtered views.
		const all = await listAllLocations(r.api, r.token);
		expect(all.find((l) => l.location_code === r.code)?.accepts_booking).toBe(true);
		expect(all.find((l) => l.location_code === r.closedCode)?.accepts_booking).toBe(false);

		// A value that is not a boolean is a validation error, not a 500.
		const bad = await callExtPath(r.api, r.token, 'GET', '/external/locations', {
			query: { accepts_booking: 'abc' }
		});
		expectExtError(bad, 422, 'validation_error');
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

	test('E12-1 EXT-012 finds the pre-registered booking by CID: masked, no family, CID never echoed', async () => {
		test.setTimeout(120_000);
		const r = state();
		await waitForProjectedStay(r.cid, 'pre_registered');
		const res = await call(r, r.token, byExt('EXT-012'));
		expect(res.status, `EXT-012 (code ${res.body?.code})`).toBe(200);
		expect(res.body).toMatchObject({ status: 200, message: 'Found Data.' });
		expect(res.body.result).toHaveLength(1);
		const [hit] = res.body.result as Record<string, unknown>[];
		expect(hit.status).toBe('pre_registered');
		expect(hit.national_id).toMatch(/^\d{3}-XXXX-XX-\d{3}$/);
		for (const key of ['family_members', 'phone', 'passport']) {
			expect(hit, `EXT-012 hit has no "${key}"`).not.toHaveProperty(key);
		}
		// Boolean only: a failing assertion must not echo the CID or the body.
		expect(
			JSON.stringify(res.body).includes(r.cid),
			'EXT-012 response never contains the CID in plaintext'
		).toBe(false);
	});

	test('E12-2 EXT-012 answers Cache-Control: no-store', async () => {
		const r = state();
		const res = await call(r, r.token, byExt('EXT-012'));
		expect(res.status, `EXT-012 (code ${res.body?.code})`).toBe(200);
		expect(res.headers['cache-control'] ?? '').toContain('no-store');
	});

	test('E12-3 EXT-012 without a purpose is 400 missing_purpose', async () => {
		const r = state();
		const res = await callExtPath(r.api, r.token, 'POST', byExt('EXT-012').path(ctxOf(r)), {
			body: { search: r.cid }
		});
		expectExtError(res, 400, 'missing_purpose');
	});

	test('E12-4 EXT-012 with a one-character query is 422 validation_error', async () => {
		const r = state();
		const res = await call(r, r.token, byExt('EXT-012'), ctxOf(r), { body: { search: 'a' } });
		expectExtError(res, 422, 'validation_error');
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
		const other = await createLedgeredClient(
			r.admin,
			r.api,
			ledger,
			secrets,
			ISOLATION_CLIENT_NAME,
			['booking-write']
		);
		const otherToken = other.token;
		r.writeOnly = { clientId: other.clientId, token: other.token };

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

	test('B3 EXT-008 on a shelter closed to bookings: booking-write alone is 409', async () => {
		test.setTimeout(120_000);
		const r = state();
		expect(r.writeOnly, 'needs the booking-write-only client made by A3b').toBeDefined();
		const { clientId, token } = r.writeOnly!;
		const res = await bookClosedShelter(r, token, clientId);
		// Not 403 (it holds booking-write) and not 201 (the shelter does not accept bookings).
		expectExtError(res, 409, 'location_not_bookable', 'EXT-008 on the closed shelter');
	});

	test('B4 EXT-008 with booking-bypass books the closed shelter, then cancels it', async () => {
		test.setTimeout(180_000);
		const r = state();
		const eoc = await createLedgeredClient(r.admin, r.api, ledger, secrets, BYPASS_CLIENT_NAME, [
			'booking-write',
			'booking-bypass'
		]);
		expect(eoc.scopes.slice().sort()).toEqual(['booking-bypass', 'booking-write']);

		const ctx = closedCtxOf(r);
		const created = await bookClosedShelter(r, eoc.token, eoc.clientId, ctx);
		expect(created.status, `bypass create (code ${created.body?.code})`).toBe(201);
		expect(created.body.result).toMatchObject({
			location_code: r.closedCode,
			booking_status: 'BOOKED',
			persons_count: 1
		});
		const bookingId = created.body.result.booking_id as string;
		expect(bookingId).toBeTruthy();
		const own: ExtCtx = { ...ctx, bookingId };

		const status = await call(r, eoc.token, byExt('EXT-010'), own, {}, eoc.clientId);
		expect(status.status).toBe(200);
		expect(status.body.result).toMatchObject({
			booking_id: bookingId,
			location_code: r.closedCode,
			booking_status: 'BOOKED'
		});
		await waitForWorkerWrite(r.closedCode, bookingId);

		const cancel = await call(r, eoc.token, byExt('EXT-009'), own, {}, eoc.clientId);
		expect(cancel.status, `cancel (code ${cancel.body?.code})`).toBe(200);
		expect(cancel.body.result).toMatchObject({
			booking_id: bookingId,
			booking_status: 'CANCELLED'
		});
		await waitForWorkerWrite(r.closedCode, bookingId, 'cancelled');
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

	test('E12-5 EXT-012 drops a cancelled booking: 200 with an empty result', async () => {
		test.setTimeout(120_000);
		const r = state();
		expect(r.bookingId, 'needs the booking created and cancelled by A3').not.toBe(
			'bk_e2e_not_booked_yet'
		);
		// The same projection lag as EXT-011 above: before it shows `cancelled`, the row is still
		// `pre_registered` and an empty result would prove nothing.
		await waitForProjectedStay(r.cid, 'cancelled');
		const res = await call(r, r.token, byExt('EXT-012'));
		expect(res.status, `EXT-012 (code ${res.body?.code})`).toBe(200);
		expect(res.body.result).toEqual([]);
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

				const gated = PARTNER_ENDPOINTS.filter((e) => e.scope === scope);
				const probe = SCOPE_PROBES[scope];
				// A scope that gates no endpoint must say how its absence is observed, else it would
				// pass this matrix without a single assertion.
				expect(
					gated.length + (probe ? 1 : 0),
					`${scope} has an endpoint or a probe`
				).toBeGreaterThan(0);
				for (const endpoint of gated) {
					// A fresh CID per attempt: if the gate failed, the booking would be real.
					const res = await call(r, minted.access_token, endpoint, {
						...ctxOf(r),
						cid: freshCid()
					});
					expectExtError(res, 403, 'insufficient_scope', `${endpoint.ext} without ${scope}`);
				}
				if (probe) {
					// No endpoint of its own: without `booking-bypass` the closed-for-bookings shelter
					// is refused by the normal rule (409), not by the scope gate (403).
					const res = await bookClosedShelter(r, minted.access_token, r.clientId);
					expectExtError(res, probe.status, probe.code, `${probe.ext} without ${scope}`);
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
		expect(done.shelters.slice().sort()).toEqual([r.code, r.closedCode].sort());
		// Main + isolation (A3b) + bypass (B4) clients.
		expect(done.clients.length).toBeGreaterThanOrEqual(3);
		await expectPartnerRunGone(r.admin, done);
		expect(ledger.read()).toEqual({ clients: [], clientNames: [], shelters: [], bookings: [] });
	});
});
