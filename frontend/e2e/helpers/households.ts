/**
 * Shared helpers for the real-CouchDB household E2E suites
 * (`household-pre-register.test.ts`, `household-post-arrival.test.ts`).
 *
 * Everything here talks to the real database — nothing is mocked except the
 * deliberate 409 fault injection in `conflictOnDocWrites`.
 */

import { expect, type Page } from '@playwright/test';
import { COUCH_BASE, couchReq } from './couch';

/** The `pnpm preview` server playwright.config.ts starts (its `baseURL`). */
export const APP_BASE_URL = 'http://localhost:4173';

export const SHELTER_CODE = 'SH001';
export const SHELTER_DB = 'shelter_sh001';
const REGISTRY_DB = 'registry';

export type CouchDoc = Record<string, unknown> & { _id: string; _rev: string };

// ─── Transport ─────────────────────────────────────────────────────────────────

/**
 * The `test`-mode build points the browser straight at CouchDB (`COUCH_BASE`), which
 * has no CORS locally. Re-send those calls through the preview server's same-origin
 * `/couch` proxy (the `daily-sop.test.ts` pattern) — the data still comes from the real DB.
 */
export async function routeCouchThroughApp(page: Page): Promise<void> {
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const origin = new URL(request.url());
		const corsHeaders = {
			'access-control-allow-origin': APP_BASE_URL,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept'
		};
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}
		try {
			const response = await route.fetch({
				url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
			});
			await route.fulfill({ response, headers: { ...response.headers(), ...corsHeaders } });
		} catch {
			// The page closed mid-request (e.g. a long-poll `_changes` at test end).
		}
	});
}

/**
 * Answer every document write (PUT `/<db>/<docid>` or POST `/<db>/_bulk_docs`) with
 * 409 Conflict — deterministic concurrency fault injection. Reads and `_find`/`_changes`
 * still reach the real DB. Registered after `routeCouchThroughApp`, so it wins.
 * Returns the number of writes it refused so far.
 */
export async function conflictOnDocWrites(page: Page, db = SHELTER_DB): Promise<() => number> {
	let refused = 0;
	await page.route(`${COUCH_BASE}/${db}/**`, async (route) => {
		const request = route.request();
		const last = new URL(request.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
		const isDocPut = request.method() === 'PUT' && !last.startsWith('_');
		const isBulk = request.method() === 'POST' && last === '_bulk_docs';
		if (!isDocPut && !isBulk) {
			await route.fallback();
			return;
		}
		refused++;
		await route.fulfill({
			status: 409,
			contentType: 'application/json',
			headers: {
				'access-control-allow-origin': APP_BASE_URL,
				'access-control-allow-credentials': 'true'
			},
			body: JSON.stringify({ error: 'conflict', reason: 'Document update conflict.' })
		});
	});
	return () => refused;
}

/**
 * Record every request the page makes to the public plane (`/api/public/*` BFF or
 * FastAPI `/public/v1/*`). Staff wizards must never touch it (PII stays on CouchDB).
 */
export function trackPublicPlaneCalls(page: Page): string[] {
	const calls: string[] = [];
	page.on('request', (request) => {
		const { pathname } = new URL(request.url());
		if (pathname.startsWith('/api/public/') || pathname.startsWith('/public/v1/')) {
			calls.push(`${request.method()} ${pathname}`);
		}
	});
	return calls;
}

// ─── Accounts ──────────────────────────────────────────────────────────────────

/**
 * A freshly minted user has no `security_question`, and the post-login gate sends
 * anyone in that state to `/force-setup` before any back-office route renders. Seed
 * one so these tests exercise the wizard and not the onboarding flow.
 */
export async function seedSecurityQuestion(name: string): Promise<void> {
	const path = `/_users/org.couchdb.user:${encodeURIComponent(name)}`;
	const got = await couchReq('GET', path);
	const doc = got.data as Record<string, unknown>;
	const res = await couchReq('PUT', path, {
		...doc,
		security_question: {
			question_id: 'high_school',
			answer_hash: 'e2e'.padEnd(64, '0'),
			salt: 'e2e'.padEnd(32, '0'),
			set_at: new Date().toISOString()
		},
		must_change_password: false
	});
	if (res.status >= 400) {
		throw new Error(`Could not seed security question for "${name}" (HTTP ${res.status})`);
	}
}

/**
 * Write `doc` to `db` with the user's own `AuthSession` cookie — straight to CouchDB,
 * no browser, no route guard. Proves what the server (validate_doc_update + _security)
 * enforces on its own.
 */
export async function putDocAsSession(
	session: string,
	doc: Record<string, unknown> & { _id: string },
	db = SHELTER_DB
): Promise<number> {
	const res = await fetch(`${COUCH_BASE}/${db}/${encodeURIComponent(doc._id)}`, {
		method: 'PUT',
		headers: {
			Cookie: `AuthSession=${session}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify(doc)
	});
	return res.status;
}

// ─── Registry (SH001 master data) ──────────────────────────────────────────────

export type Zone = { code: string; name: string };

/**
 * Resolve zone display names from the shelter's registry doc — the same doc the UI
 * renders — so locators follow whatever the seed wrote. Persisted data is still
 * asserted by `code`.
 */
export async function loadShelterZones<const C extends string>(
	codes: readonly C[],
	shelterCode = SHELTER_CODE
): Promise<Record<C, Zone>> {
	const res = await couchReq('POST', `/${REGISTRY_DB}/_find`, {
		selector: { type: 'shelter', code: shelterCode },
		fields: ['zones'],
		limit: 1
	});
	const [shelter] = (res.data as { docs?: { zones?: Zone[] }[] } | null)?.docs ?? [];
	if (!shelter) throw new Error(`Registry has no shelter ${shelterCode} — seed CouchDB first`);
	const out = {} as Record<C, Zone>;
	for (const code of codes) {
		const zone = shelter.zones?.find((z) => z.code === code);
		if (!zone) throw new Error(`Registry shelter ${shelterCode} has no zone ${code}`);
		out[code] = { code: zone.code, name: zone.name };
	}
	return out;
}

// ─── Shelter DB (admin, Node side) ─────────────────────────────────────────────

export async function findDocs(
	selector: Record<string, unknown>,
	db = SHELTER_DB
): Promise<CouchDoc[]> {
	const res = await couchReq('POST', `/${db}/_find`, { selector, limit: 1000 });
	if (res.status !== 200) throw new Error(`_find on ${db} failed (HTTP ${res.status})`);
	return (res.data as { docs: CouchDoc[] }).docs;
}

export async function getDoc(id: string, db = SHELTER_DB): Promise<CouchDoc> {
	const res = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	if (res.status !== 200) throw new Error(`GET ${db}/${id} failed (HTTP ${res.status})`);
	return res.data as CouchDoc;
}

/**
 * Delete every doc in `db` whose `created_by` is one of `names`. Deleting (not
 * purging) lets the sync worker see the tombstones and drop the Mongo projections too.
 */
export async function deleteDocsCreatedBy(names: string[], db = SHELTER_DB): Promise<void> {
	const docs = await findDocs({ created_by: { $in: names } }, db);
	if (docs.length === 0) return;
	const res = await couchReq('POST', `/${db}/_bulk_docs`, {
		docs: docs.map((d) => ({ _id: d._id, _rev: d._rev, _deleted: true }))
	});
	if (res.status >= 400) throw new Error(`Clean-up _bulk_docs failed (HTTP ${res.status})`);
}

// ─── Browser ───────────────────────────────────────────────────────────────────

/** The shell re-renders once the session is verified and the shelter doc arrives — type only after. */
export async function waitForAppSettled(page: Page, shelterCode = SHELTER_CODE): Promise<void> {
	await expect(page.getByRole('button', { name: 'เลือกศูนย์อพยพ' })).toContainText(shelterCode, {
		timeout: 20_000
	});
}
