/**
 * Helpers for the Partner API suite (`partner-api.test.ts`, EXT-001…012, ADR 0002).
 *
 * The suite drives the real `/external/*` plane (FastAPI, no BFF in between) with tokens it
 * mints itself, and manages its own `E2E partner …` clients through the staff BFF
 * `/api/v1/thirdparty-clients` (the same routes the System management → API Keys screen uses).
 *
 * Everything a run creates is written to {@link PartnerLedger} the moment it exists, so a
 * crashed or restarted run is cleaned up by the next teardown without ever searching for data.
 * Client secrets are never persisted or logged: a teardown that no longer holds a secret
 * regenerates one through the BFF just to cancel its bookings.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import {
	GRANTABLE_SCOPES,
	normalizeThirdPartyClientList,
	type GrantableScope,
	type ThirdPartyClient
} from '../../src/lib/features/third-party-clients/domain/third-party-client';
import { bootstrapAdminSession, couchReq } from './couch';
import { IS_REMOTE, appBaseUrl } from './e2e-env';
import { fictitiousNationalId } from './pre-register';
import { publicShelter, teardownShelter } from './public-cleanup';

// ─── Scopes + endpoint table ───────────────────────────────────────────────────

/**
 * The eight scopes a partner client can hold (`tent_model.third_party_client`, mirrored by the
 * staff UI's `GRANTABLE_SCOPES`), imported so a new scope cannot be forgotten here.
 */
export const PARTNER_SCOPES = GRANTABLE_SCOPES;
export type PartnerScope = GrantableScope;

/** What a scope without an endpoint of its own changes (a flag on another call, not a route). */
export interface ScopeProbe {
	/** The endpoint whose behaviour the scope alters. */
	ext: 'EXT-008';
	/** Answer a client WITHOUT the scope gets (the scope present would turn it into a 201). */
	status: number;
	code: string;
}

/**
 * A4 removes each scope in turn and asserts the endpoints that need it answer 403. A scope that
 * is not a gate on any route has nothing to assert that way, so it lists its probe here: the
 * call that behaves differently without it. `booking-bypass` (#751) lets a `booking-write`
 * client book a shelter that is closed to bookings; without it that call is a 409, never a 403.
 * A scope with neither an endpoint in {@link PARTNER_ENDPOINTS} nor a probe fails A4 loudly.
 */
export const SCOPE_PROBES: Readonly<Record<string, ScopeProbe>> = {
	'booking-bypass': { ext: 'EXT-008', status: 409, code: 'location_not_bookable' }
};

/**
 * FastAPI origin the `/external/*` plane is reached on. A remote run (`E2E_BASE_URL` set) uses
 * `E2E_FASTAPI_URL`; a local run (no `E2E_BASE_URL`) must stay on loopback, so a `.env` copied
 * from staging can never aim a local run's client credentials at the staging host.
 */
export function partnerApiUrl(): string {
	const configured = process.env.E2E_FASTAPI_URL?.trim();
	if (!IS_REMOTE) {
		const url = (configured || 'http://localhost:9000').replace(/\/$/, '');
		const host = new URL(url).hostname;
		if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
			throw new Error(
				`E2E_FASTAPI_URL points at ${host} but E2E_BASE_URL is unset (local run): refusing to send partner ` +
					'credentials off-box. Unset E2E_FASTAPI_URL or set E2E_BASE_URL for a staging run.'
			);
		}
		return url;
	}
	if (!configured) {
		throw new Error(
			'E2E_FASTAPI_URL is not set but E2E_BASE_URL is (remote run): the partner suite needs the ' +
				'FastAPI origin (e.g. https://<host>/public-api) and will not fall back to localhost.'
		);
	}
	return configured.replace(/\/$/, '');
}

export interface ExtCtx {
	/** The run's own E2E shelter. */
	code: string;
	bookingId: string;
	/** A checksum-valid fictitious national ID. */
	cid: string;
}

export interface PartnerEndpoint {
	ext: string;
	method: 'GET' | 'POST';
	path: (ctx: ExtCtx) => string;
	scope: PartnerScope;
	/** 007 / 011 / 012 check `purpose` before the scope, so every call carries one. */
	query?: (ctx: ExtCtx) => Record<string, string>;
	body?: (ctx: ExtCtx) => unknown;
	/** Status a fully-scoped token gets for this request in the matrix (not the 401 sweep). */
	okStatus: number;
}

const PURPOSE = { purpose: 'e2e-partner-api' };

let cidSeq = 0;
/** Fresh fictitious CID per call (IDs start with 0, so they can never belong to a real person). */
export function freshCid(): string {
	cidSeq += 1;
	return fictitiousNationalId(Date.now() * 10 + (cidSeq % 10));
}

/** A valid single-person booking body for `code` with a fresh fictitious CID. */
export function bookingBody(code: string, cid = freshCid()) {
	return {
		location_code: code,
		persons: [{ cid, first_name: 'E2E', last_name: 'Partner', phone: '+66800000000' }]
	};
}

export const PARTNER_ENDPOINTS: readonly PartnerEndpoint[] = [
	{
		ext: 'EXT-002',
		method: 'GET',
		path: () => '/external/locations',
		scope: 'location-read',
		okStatus: 200
	},
	{
		ext: 'EXT-003',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}`,
		scope: 'location-read',
		okStatus: 200
	},
	{
		ext: 'EXT-004',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}/stock`,
		scope: 'location-stock-read',
		okStatus: 200
	},
	{
		ext: 'EXT-005',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}/occupancy`,
		scope: 'occupancy-read',
		okStatus: 200
	},
	{
		ext: 'EXT-006',
		method: 'GET',
		path: () => '/external/summary',
		scope: 'location-read',
		okStatus: 200
	},
	{
		ext: 'EXT-007',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}/occupants`,
		scope: 'occupancy-pii-read',
		query: () => PURPOSE,
		okStatus: 200
	},
	{
		ext: 'EXT-008',
		method: 'POST',
		path: () => '/external/bookings',
		scope: 'booking-write',
		// A valid body on purpose: if the scope gate ever lets this through, a real booking is
		// created — the matrix records it in the ledger so teardown still cancels it.
		body: (c) => bookingBody(c.code, c.cid),
		okStatus: 201
	},
	{
		ext: 'EXT-009',
		method: 'POST',
		path: (c) => `/external/bookings/${c.bookingId}/cancel`,
		scope: 'booking-write',
		okStatus: 200
	},
	{
		ext: 'EXT-010',
		method: 'GET',
		path: (c) => `/external/bookings/${c.bookingId}`,
		scope: 'booking-write',
		okStatus: 200
	},
	{
		ext: 'EXT-011',
		method: 'GET',
		path: () => '/external/persons/shelter-residency',
		scope: 'residency-read',
		query: (c) => ({ ...PURPOSE, cid: c.cid }),
		// A CID nobody checked in under: 404 residency_not_found is the "scope passed" answer.
		okStatus: 404
	},
	{
		ext: 'EXT-012',
		method: 'POST',
		path: () => '/external/persons/search',
		scope: 'occupant-search',
		query: () => PURPOSE,
		// E12-* send the run's own CID; the scope matrix overrides `cid` with a fresh, never-booked one,
		// so 200 with an empty `result` is its "scope passed" answer.
		body: (c) => ({ search: c.cid }),
		okStatus: 200
	}
];

// ─── External calls ────────────────────────────────────────────────────────────

export interface ExtResponse {
	status: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per endpoint
	body: any;
	headers: Record<string, string>;
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	module_name: string | null;
	scopes: string[];
}

/** Raw `/external/token` call — callers assert on the status. */
export async function postToken(
	request: APIRequestContext,
	payload: Record<string, unknown>
): Promise<ExtResponse> {
	return toExtResponse(
		await request.post(`${partnerApiUrl()}/external/token`, {
			data: payload,
			failOnStatusCode: false
		})
	);
}

/** Mint a token for `client_credentials` and return the whole body (never log it). */
export async function mintToken(
	request: APIRequestContext,
	clientId: string,
	secret: string
): Promise<TokenResponse> {
	const res = await postToken(request, {
		grant_type: 'client_credentials',
		client_id: clientId,
		client_secret: secret
	});
	expect(res.status, `mint token for ${clientId}`).toBe(200);
	return res.body as TokenResponse;
}

async function toExtResponse(res: Awaited<ReturnType<APIRequestContext['fetch']>>) {
	const text = await res.text();
	const parse = (): unknown => {
		try {
			return text ? JSON.parse(text) : null;
		} catch {
			return text;
		}
	};
	return { status: res.status(), body: parse(), headers: res.headers() } as ExtResponse;
}

export interface CallOptions {
	/** Extra headers, e.g. `Idempotency-Key` on EXT-008. */
	headers?: Record<string, string>;
	/** Overrides the endpoint's own body (EXT-008 retry / reuse cases). */
	body?: unknown;
}

/** Call one table endpoint. `token = null` sends no Authorization header. */
export async function callExt(
	request: APIRequestContext,
	token: string | null,
	endpoint: PartnerEndpoint,
	ctx: ExtCtx,
	options: CallOptions = {}
): Promise<ExtResponse> {
	return callExtPath(request, token, endpoint.method, endpoint.path(ctx), {
		query: endpoint.query?.(ctx),
		body: options.body ?? endpoint.body?.(ctx),
		headers: options.headers
	});
}

/** Call an arbitrary `/external/*` path (ad-hoc cases outside the endpoint table). */
export async function callExtPath(
	request: APIRequestContext,
	token: string | null,
	method: 'GET' | 'POST',
	path: string,
	opts: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<ExtResponse> {
	const url = new URL(`${partnerApiUrl()}${path}`);
	for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
	return toExtResponse(
		await request.fetch(url.toString(), {
			method,
			headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
			...(opts.body !== undefined ? { data: opts.body } : {}),
			failOnStatusCode: false
		})
	);
}

/**
 * Every `/external/*` error body is `{ status, message, code }` (apiapp/core/http_error.py).
 */
export function expectExtError(res: ExtResponse, status: number, code: string, label = ''): void {
	const what = label ? `${label}: ` : '';
	expect(res.status, `${what}HTTP status (code ${res.body?.code})`).toBe(status);
	expect(res.body, `${what}error body`).toMatchObject({
		status,
		code,
		message: expect.any(String)
	});
}

/** One row of EXT-002 (the fields the suite reads). */
export interface LocationRow {
	location_code: string;
	accepts_booking?: boolean;
}

/** Walk every page of EXT-002 (limit 200, capped at 20 pages) with the given filters. */
export async function listAllLocations(
	request: APIRequestContext,
	token: string,
	query: Record<string, string> = {}
): Promise<LocationRow[]> {
	const rows: LocationRow[] = [];
	for (let page = 1; page <= 20; page++) {
		const res = await callExtPath(request, token, 'GET', '/external/locations', {
			query: { ...query, limit: '200', page: String(page) }
		});
		expect(res.status, `EXT-002 page ${page} (code ${res.body?.code})`).toBe(200);
		const batch = res.body.result as LocationRow[];
		rows.push(...batch);
		if (batch.length < 200) break;
	}
	return rows;
}

// ─── Admin BFF (staff session) ─────────────────────────────────────────────────

/**
 * The staff BFF `/api/v1/thirdparty-clients`. Authenticated with an explicit `AuthSession`
 * cookie minted from `bootstrapAdminSession()` (CouchDB `_admin`, which the BFF treats as
 * system admin on local and staging alike), so it works from afterAll and from a teardown with
 * no browser page. The BFF adds `EXTERNAL_API_SECRET` toward
 * FastAPI itself — the test side never sees that secret.
 */
export class PartnerAdmin {
	private cookie: { value: string; at: number } | undefined;

	constructor(private readonly request: APIRequestContext) {}

	/** CouchDB sessions last 10 minutes by default; re-login well before that. */
	private async sessionCookie(): Promise<string> {
		if (!this.cookie || Date.now() - this.cookie.at > 4 * 60_000) {
			this.cookie = { value: (await bootstrapAdminSession()).cookie, at: Date.now() };
		}
		return this.cookie.value;
	}

	private async call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
		const cookie = await this.sessionCookie();
		const res = await this.request.fetch(`${appBaseUrl()}/api/v1/thirdparty-clients${path}`, {
			method,
			headers: { Cookie: `AuthSession=${cookie}`, Accept: 'application/json' },
			...(data !== undefined ? { data } : {}),
			failOnStatusCode: false
		});
		const body = await res.json().catch(() => null);
		return { status: res.status(), body };
	}

	async listClients(): Promise<ThirdPartyClient[]> {
		const res = await this.call('GET', '');
		expect(res.status, 'list partner clients').toBe(200);
		return normalizeThirdPartyClientList(res.body);
	}

	async patchScopes(rowId: string, scopes: readonly string[]): Promise<ThirdPartyClient> {
		const res = await this.call('PATCH', `/${encodeURIComponent(rowId)}`, {
			allowed_scopes: scopes
		});
		expect(res.status, `patch scopes (${res.body?.error?.message ?? ''})`).toBe(200);
		return res.body as ThirdPartyClient;
	}

	/**
	 * Create a client through the BFF (secondary fixtures only; the main one is made in the UI).
	 * `record` runs on the response body BEFORE any assertion, so the client reaches the ledger
	 * even when the call is then judged a failure.
	 */
	async createClient(
		name: string,
		scopes: readonly string[],
		record: (created: ThirdPartyClient) => void
	): Promise<ThirdPartyClient & { client_secret: string }> {
		const res = await this.call('POST', '', { name, allowed_scopes: scopes });
		const created = res.body as (ThirdPartyClient & { client_secret: string }) | null;
		if (created?.id && created.client_id) record(created);
		expect(res.status, `create partner client (${res.body?.error?.message ?? ''})`).toBe(201);
		return created!;
	}

	/** Issue a new secret (the old one stops working) — how teardown mints without a stored one. */
	async regenerateSecret(rowId: string): Promise<string> {
		const res = await this.call('POST', `/${encodeURIComponent(rowId)}/regenerate-secret`);
		expect(res.status, 'regenerate partner secret').toBe(200);
		return (res.body as { client_secret: string }).client_secret;
	}

	async revokeClient(rowId: string): Promise<void> {
		const res = await this.call('POST', `/${encodeURIComponent(rowId)}/revoke`);
		// 409 = already revoked, 404 = already gone.
		expect([200, 404, 409], 'revoke partner client').toContain(res.status);
	}

	async deleteClient(rowId: string): Promise<void> {
		const res = await this.call('DELETE', `/${encodeURIComponent(rowId)}`);
		expect([200, 404], 'delete partner client').toContain(res.status);
	}
}

/**
 * A secondary fixture client: ledger its name, create it through the BFF (ledgering the id before
 * any assertion), remember its secret in memory and mint a token. Returns what a test needs.
 */
export async function createLedgeredClient(
	admin: PartnerAdmin,
	request: APIRequestContext,
	ledger: PartnerLedger,
	secrets: Map<string, string>,
	name: string,
	scopes: readonly string[]
): Promise<{ clientId: string; token: string; scopes: string[] }> {
	ledger.add('clientNames', name);
	const created = await admin.createClient(name, scopes, (c) =>
		ledger.add('clients', { rowId: c.id, clientId: c.client_id })
	);
	secrets.set(created.client_id, created.client_secret);
	const minted = await mintToken(request, created.client_id, created.client_secret);
	return { clientId: created.client_id, token: minted.access_token, scopes: minted.scopes };
}

// ─── Per-run ledger ────────────────────────────────────────────────────────────

const LEDGER_PATH = 'node_modules/.cache/partner-api-e2e-created.json';

export interface LedgerClient {
	/** BFF row id (`id`), what PATCH / revoke / delete take. */
	rowId: string;
	/** `tpc_…`, what `/external/token` takes. */
	clientId: string;
}
export interface LedgerBooking {
	/** Empty while the create call has no answer yet — `idempotencyKey` + `body` recover it. */
	bookingId: string;
	clientId: string;
	/** Unique per EXT-008 call (a replay shares its `idempotencyKey`, never its `intent`). */
	intent?: string;
	/** Written BEFORE the EXT-008 request; replaying key + body returns (or makes) the booking. */
	idempotencyKey?: string;
	body?: unknown;
}
interface LedgerData {
	clients: LedgerClient[];
	/**
	 * Exact names of clients about to be created, written BEFORE the create call. A run killed
	 * between the create and the moment its id is known is still recovered: teardown ledgers the
	 * listed client whose name equals one of these (run-unique) names — never a prefix search.
	 */
	clientNames: string[];
	shelters: string[];
	bookings: LedgerBooking[];
}

/**
 * Everything one run creates, written the moment it exists. Playwright restarts the worker
 * after a failed serial test, which wipes module state — a file survives that (and a crashed
 * run), so the next teardown removes exactly the ids recorded here, never anything found by
 * searching. Same shape as `RunLedger` in `donation-fullstack.ts`.
 */
export class PartnerLedger {
	constructor(private readonly suite = 'partner-api') {}

	private readAll(): Record<string, LedgerData> {
		try {
			return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Record<string, LedgerData>;
		} catch {
			return {};
		}
	}

	read(): LedgerData {
		const mine = this.readAll()[this.suite];
		return {
			clients: mine?.clients ?? [],
			clientNames: mine?.clientNames ?? [],
			shelters: mine?.shelters ?? [],
			bookings: mine?.bookings ?? []
		};
	}

	private write(data: LedgerData) {
		mkdirSync(dirname(LEDGER_PATH), { recursive: true });
		writeFileSync(LEDGER_PATH, JSON.stringify({ ...this.readAll(), [this.suite]: data }));
	}

	add(kind: 'shelters' | 'clientNames', value: string): void;
	add(kind: 'clients', value: LedgerClient): void;
	add(kind: 'bookings', value: LedgerBooking): void;
	add(kind: keyof LedgerData, value: string | LedgerClient | LedgerBooking): void {
		const data = this.read();
		(data[kind] as (string | LedgerClient | LedgerBooking)[]).push(value);
		this.write(data);
	}

	/** Fill in the booking id once the create answered 201. */
	resolveBooking(intent: string, bookingId: string): void {
		const data = this.read();
		for (const b of data.bookings) if (b.intent === intent) b.bookingId = bookingId;
		this.write(data);
	}

	/** The create was answered without making a booking (4xx) — nothing to recover. */
	dropBookingIntent(intent: string): void {
		const data = this.read();
		data.bookings = data.bookings.filter((b) => b.intent !== intent);
		this.write(data);
	}

	clear(): void {
		this.write({ clients: [], clientNames: [], shelters: [], bookings: [] });
	}
}

// ─── Teardown + zero-leak check ────────────────────────────────────────────────

export type PartnerRun = LedgerData;

/**
 * Assumption: the sync worker ticks every 3 s, so a booking with still no CouchDB doc after
 * this long (well over ten ticks, backlog included) was cancelled before the worker wrote it.
 */
const NEVER_WRITTEN_AFTER_MS = 40_000;

/**
 * Wait for the sync worker to apply the cancel to the shelter DB(s) — `cancel_requested` is only
 * a flag until the worker (3 s tick) turns the stay into `cancelled`. Deleting the shelter first
 * would strand that row in Mongo for good (the partner janitor then skips the client). Bounded
 * and soft: a booking whose docs never appear (cancelled before the worker wrote it) is given
 * up on after {@link NEVER_WRITTEN_AFTER_MS}, and returns the ids still unconfirmed when the wait runs out.
 * Ids in `noCancelSent` get no never-written shortcut: no cancel went out for them in teardown, so
 * "no docs yet" may just be a slow worker about to write a live booking.
 */
async function waitForWorkerCancels(
	shelters: readonly string[],
	bookingIds: readonly string[],
	noCancelSent: ReadonlySet<string> = new Set(),
	timeoutMs = 90_000
): Promise<string[]> {
	if (bookingIds.length === 0) return [];
	const pending = new Set(bookingIds);
	const started = Date.now();
	const deadline = started + timeoutMs;
	while (pending.size > 0 && Date.now() < deadline) {
		for (const id of [...pending]) {
			for (const code of shelters) {
				const res = await couchReq('POST', `/shelter_${code.toLowerCase()}/_find`, {
					selector: { type: 'evacuee', booking_ref: id },
					limit: 5
				}).catch(() => undefined);
				if (!res) continue;
				// 404: the shelter DB is already gone — nothing left to apply the cancel to.
				const docs = (res.data as { docs?: { current_stay?: { status?: string } }[] })?.docs ?? [];
				// No docs after a few worker ticks: the row was cancelled before the worker wrote it,
				// which leaves a terminal `cancelled` row and nothing in CouchDB to wait for.
				const neverWritten =
					!noCancelSent.has(id) &&
					docs.length === 0 &&
					Date.now() - started > NEVER_WRITTEN_AFTER_MS;
				if (
					res.status === 404 ||
					neverWritten ||
					(docs.length > 0 && docs.every((d) => d.current_stay?.status === 'cancelled'))
				) {
					pending.delete(id);
				}
			}
		}
		if (pending.size > 0) await new Promise((r) => setTimeout(r, 3_000));
	}
	return [...pending];
}

/**
 * Cancel every open booking in the ledger as the client that made it, then wait until the worker
 * has applied the cancels. A ledger entry without a `bookingId` is a create whose answer never
 * arrived: replaying its key + body returns (or makes) the booking so it can be cancelled.
 * Returns everything NOT confirmed cancelled: ids the worker never confirmed, plus `intent:<x>`
 * labels for ledgered bookings that could not even be resolved to an id (so teardown fails loudly
 * and keeps the ledger rather than reporting success over a possibly live booking).
 */
async function cancelLedgerBookings(
	request: APIRequestContext,
	admin: PartnerAdmin,
	run: PartnerRun,
	secrets: ReadonlyMap<string, string>
): Promise<string[]> {
	const rows = await admin.listClients();
	/** Booking ids whose cancel the worker must confirm in the shelter DB. */
	const toConfirm: string[] = [];
	/** Ids of inactive clients' bookings — confirmed only by a `cancelled` stay in CouchDB. */
	const noCancelSent = new Set<string>();
	/** Ledgered bookings that could not be resolved to an id — always reported unconfirmed. */
	const unresolved: string[] = [];
	const unresolvedLabel = (b: LedgerBooking) =>
		`intent:${b.intent ?? b.idempotencyKey ?? 'unknown'}`;
	for (const client of run.clients) {
		const bookings = run.bookings.filter((b) => b.clientId === client.clientId);
		if (bookings.length === 0) continue;
		// A revoked / deleted client cannot mint any more — nothing left to cancel as it.
		if (!rows.some((r) => r.id === client.rowId && r.is_active)) {
			// Cannot cancel as this client any more (the run revokes / deletes it in A7-A8). Whether
			// its bookings were already cancelled in-run is only knowable from the worker's result, so
			// they go through the same wait: any still not cancelled come back as unconfirmed and make
			// teardown / Z fail loudly instead of silently leaving a live booking behind.
			const ids = [...new Set(bookings.map((b) => b.bookingId).filter(Boolean))];
			const idless = bookings.filter((b) => !b.bookingId);
			console.warn(
				`client ${client.clientId} is no longer active: verifying ledgered booking(s) ` +
					`${ids.join(', ') || '(none with an id)'} cancelled via the worker instead of cancelling them` +
					(idless.length > 0
						? `; ${idless.length} ledgered booking(s) have no id and stay unconfirmed`
						: '')
			);
			for (const id of ids) noCancelSent.add(id);
			toConfirm.push(...ids);
			unresolved.push(...idless.map(unresolvedLabel));
			continue;
		}
		// The run may have removed `booking-write` (A6) — cancelling needs it back.
		await admin.patchScopes(client.rowId, PARTNER_SCOPES);
		const secret = secrets.get(client.clientId) ?? (await admin.regenerateSecret(client.rowId));
		const { access_token } = await mintToken(request, client.clientId, secret);
		for (const booking of bookings) {
			let bookingId = booking.bookingId;
			if (!bookingId && booking.idempotencyKey) {
				const replay = await callExtPath(request, access_token, 'POST', '/external/bookings', {
					body: booking.body,
					headers: { 'Idempotency-Key': booking.idempotencyKey }
				});
				bookingId = replay.status === 201 ? (replay.body?.result?.booking_id ?? '') : '';
				if (!bookingId) {
					console.warn(
						`replay of ledgered booking intent ${booking.intent} returned HTTP ${replay.status} without an id`
					);
				}
			}
			if (!bookingId) {
				// Create answer was lost and the replay did not give the booking back: it may be live.
				unresolved.push(unresolvedLabel(booking));
				continue;
			}
			// 200 = cancelled (also on repeat), 404 = never created / already gone.
			const res = await callExtPath(
				request,
				access_token,
				'POST',
				`/external/bookings/${bookingId}/cancel`
			);
			if (res.status === 200) toConfirm.push(bookingId);
			else if (![404, 409].includes(res.status)) {
				console.warn(`cancel ${bookingId} returned HTTP ${res.status}`);
			}
		}
	}
	return [...(await waitForWorkerCancels(run.shelters, toConfirm, noCancelSent)), ...unresolved];
}

/**
 * Ledger the id of every client whose exact name was recorded before its create call but whose id
 * never was (the run died in between). Matches `ledger.clientNames` entries only — run-unique
 * names the run itself wrote down — so it is a recovery of the run's own data, not a search.
 */
async function reconcileClientNames(admin: PartnerAdmin, ledger: PartnerLedger): Promise<void> {
	const { clients, clientNames } = ledger.read();
	if (clientNames.length === 0) return;
	const known = new Set(clients.map((c) => c.rowId));
	for (const row of await admin.listClients()) {
		if (row.name && clientNames.includes(row.name) && !known.has(row.id)) {
			ledger.add('clients', { rowId: row.id, clientId: row.client_id });
		}
	}
}

/**
 * Remove exactly what `ledger` lists: cancel still-open bookings (needs an active client) and wait
 * for the worker to apply them, tear the E2E shelter down (`teardownShelter` refuses anything not
 * named `E2E …`), then revoke and soft-delete every client, then empty the ledger. Idempotent —
 * safe from both the Z test and afterAll. `secrets` maps `client_id` → secret for clients this process still knows.
 */
export async function teardownPartnerRun(
	request: APIRequestContext,
	admin: PartnerAdmin,
	ledger: PartnerLedger,
	secrets: ReadonlyMap<string, string> = new Map()
): Promise<PartnerRun> {
	const failures: unknown[] = [];
	const step = async (fn: () => Promise<void>) => {
		try {
			await fn();
		} catch (e) {
			failures.push(e);
		}
	};
	// A client whose create was in flight when the run died has a name but no id in the ledger yet.
	await step(() => reconcileClientNames(admin, ledger));
	const run = ledger.read();
	let unconfirmed: string[] = [];
	await step(async () => {
		unconfirmed = await cancelLedgerBookings(request, admin, run, secrets);
	});
	for (const code of run.shelters) await step(() => teardownShelter(code));
	await step(async () => {
		const rows = await admin.listClients();
		for (const { rowId } of run.clients) {
			const row = rows.find((r) => r.id === rowId);
			if (!row) continue;
			if (row.is_active) await admin.revokeClient(rowId);
			await admin.deleteClient(rowId);
		}
	});
	// A cancel the worker never confirmed would leave a live Mongo row once the shelter DB is gone
	// (the partner janitor then skips that client): fail loudly and keep the ledger for the next run.
	if (unconfirmed.length > 0) {
		failures.push(
			new Error(`could not confirm the cancel of booking(s): ${unconfirmed.join(', ')}`)
		);
	}
	// Only forget what is verifiably gone: a failure keeps the ledger for the next purge.
	if (failures.length === 0) ledger.clear();
	else throw failures[0];
	return run;
}

/**
 * Zero-leak: nothing of `run` is left where the test side can see it — no shelter database or
 * registry row, a closed (unbookable) public row at most, and no client in the staff list. What
 * stays in Mongo (`external_bookings`, access logs, the soft-deleted client row) is PII-free and
 * swept by the partner janitor (README §9.C).
 */
export async function expectPartnerRunGone(admin: PartnerAdmin, run: PartnerRun): Promise<void> {
	for (const code of run.shelters) {
		expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
		const byCode = await couchReq(
			'GET',
			`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
		);
		expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
		const row = await publicShelter(code);
		expect(row === undefined || row.status === 'closed', `${code} left as ${row?.status}`).toBe(
			true
		);
	}
	const rows = await admin.listClients();
	for (const { rowId } of run.clients) {
		expect(
			rows.some((r) => r.id === rowId),
			`client ${rowId} still listed`
		).toBe(false);
	}
}
