/**
 * Teardown + projection-wait helpers for the public-plane E2E suites.
 *
 * The suites create all their data through the UI (no seeding). The UI cannot
 * delete shelters or evacuees, so afterAll removes what a run created through the
 * CouchDB admin API — teardown only, never used to set up state.
 *
 * Public pages read MongoDB projections, not CouchDB:
 *   CouchDB → sync worker → Mongo public_* → FastAPI → BFF /api/public/v1/*
 * so the suites need the full local stack (`docker compose up -d` — CouchDB, MongoDB,
 * worker, FastAPI on :9000).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { bootstrapAdminSession, couchReq } from './couch';
import { appBaseUrl, IS_REMOTE } from './e2e-env';

/** Public BFF of the app under test (see `appBaseUrl`). */
const bffBase = () => `${appBaseUrl()}/api/public/v1`;

/** Every shelter an E2E run creates carries this name prefix — teardown refuses others. */
export const E2E_SHELTER_PREFIX = 'E2E';

/**
 * Poll until `check` returns true. Intervals are deliberately slow: the public
 * search endpoint is rate-limited (30 req/min per IP) and polls share that budget.
 */
export async function waitForProjection(
	what: string,
	check: () => Promise<boolean>,
	{ timeoutMs = 10_000, intervalMs = 1_000 } = {}
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check().catch(() => false)) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`Timed out waiting for projection: ${what} (is the sync worker running?)`);
}

/** Public shelter row as the landing / directory BFF returns it. */
export interface PublicShelterRow {
	code: string;
	name?: string;
	status: string;
	capacity?: number;
}

/** Public projection of a shelter code via the BFF, or undefined if absent. */
export async function publicShelter(code: string): Promise<PublicShelterRow | undefined> {
	const res = await fetch(`${bffBase()}/shelters`);
	if (!res.ok) throw new Error(`shelters HTTP ${res.status}`);
	const { shelters } = (await res.json()) as { shelters: PublicShelterRow[] };
	return shelters.find((s) => s.code === code);
}

/** Public projection status of a shelter code via the BFF, or undefined if absent. */
export async function publicShelterStatus(code: string): Promise<string | undefined> {
	return (await publicShelter(code))?.status;
}

/**
 * Remove a shelter an E2E run created through the UI:
 *  1. set it `closed` and wait for the projection (the row the worker keeps in
 *     Mongo after a delete then reads "closed", not "open");
 *  2. delete the registry master — the worker cascades that to the shelter's
 *     public persons and needs;
 *  3. delete its CouchDB database.
 * Refuses shelters whose name does not start with {@link E2E_SHELTER_PREFIX}.
 */
export async function teardownShelter(code: string): Promise<void> {
	const byCode = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}&include_docs=true`
	);
	const doc = (byCode.data as { rows?: { doc?: Record<string, unknown> }[] })?.rows?.[0]?.doc;
	if (doc) {
		if (!String(doc.name ?? '').startsWith(E2E_SHELTER_PREFIX)) {
			throw new Error(`Refusing to tear down non-E2E shelter ${code} ("${doc.name}")`);
		}
		const path = `/registry/${encodeURIComponent(String(doc._id))}`;
		const closed = await couchReq('PUT', path, {
			...doc,
			operation_status: 'closed',
			updated_at: new Date().toISOString()
		});
		if (closed.status >= 400) throw new Error(`close ${code} failed (HTTP ${closed.status})`);
		await waitForProjection(
			`${code} closed`,
			async () => (await publicShelterStatus(code)) !== 'open'
		);
		const rev = (closed.data as { rev: string }).rev;
		const delDoc = await couchReq('DELETE', `${path}?rev=${rev}`);
		if (delDoc.status >= 400 && delDoc.status !== 404)
			console.warn(`delete master doc ${path} returned HTTP ${delDoc.status}`);
	}
	const delDb = await couchReq('DELETE', `/shelter_${code.toLowerCase()}`);
	if (delDb.status >= 400 && delDb.status !== 404)
		console.warn(`delete database shelter_${code.toLowerCase()} returned HTTP ${delDb.status}`);
}

/** Number of public search hits for `query` via the BFF. */
export async function publicSearchCount(query: string): Promise<number> {
	const res = await fetch(`${bffBase()}/occupants`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ search: query })
	});
	if (!res.ok) throw new Error(`search HTTP ${res.status}`);
	return ((await res.json()) as { results: unknown[] }).results.length;
}

interface FaqEntry {
	question?: string;
	question_en?: string;
}

/** Published public FAQ questions (TH) as the landing page receives them via the BFF. */
export async function publicFaqQuestions(): Promise<string[]> {
	const res = await fetch(`${bffBase()}/config/faqs?category=public`);
	if (!res.ok) throw new Error(`faqs HTTP ${res.status}`);
	const { faqs } = (await res.json()) as { faqs?: FaqEntry[] };
	return (faqs ?? []).map((f) => f.question ?? '');
}

/**
 * Remove every FAQ whose question contains `marker` from `registry/config:public_portal`
 * (all categories). afterAll safety net for runs that fail before the UI delete step.
 */
export async function removeTestFaqs(marker: string): Promise<void> {
	const path = '/registry/config:public_portal';
	const res = await couchReq('GET', path);
	if (res.status === 404) return;
	const doc = res.data as { faqs?: Record<string, FaqEntry[]> | FaqEntry[] };
	const isTest = (f: FaqEntry) =>
		Boolean(f.question?.includes(marker) || f.question_en?.includes(marker));
	let changed = false;
	const strip = (list: FaqEntry[]) => {
		const kept = list.filter((f) => !isTest(f));
		changed ||= kept.length !== list.length;
		return kept;
	};
	const faqs = Array.isArray(doc.faqs)
		? strip(doc.faqs)
		: Object.fromEntries(Object.entries(doc.faqs ?? {}).map(([k, v]) => [k, strip(v)]));
	if (!changed) return;
	const put = await couchReq('PUT', path, {
		...doc,
		faqs,
		updated_at: new Date().toISOString()
	});
	if (put.status >= 400) throw new Error(`remove test FAQs failed (HTTP ${put.status})`);
}

const CONTACT_LINK_FIELDS = ['line_oa_url', 'facebook_url'] as const;
export type ContactLinks = Partial<Record<(typeof CONTACT_LINK_FIELDS)[number], string>>;

/**
 * The operator's LINE / Facebook links in `config:public_portal` before a run edits them
 * through the UI — `null` when the document does not exist yet.
 */
export async function readContactLinks(): Promise<ContactLinks | null> {
	const res = await couchReq('GET', '/registry/config:public_portal');
	if (res.status === 404) return null;
	const doc = res.data as ContactLinks;
	return Object.fromEntries(
		CONTACT_LINK_FIELDS.filter((field) => doc[field] !== undefined).map((f) => [f, doc[f]])
	);
}

/** afterAll: put back the links captured by {@link readContactLinks}. */
export async function restoreContactLinks(links: ContactLinks | null): Promise<void> {
	if (!links) return;
	const path = '/registry/config:public_portal';
	const res = await couchReq('GET', path);
	if (res.status === 404) return;
	const doc = { ...(res.data as Record<string, unknown>) };
	for (const field of CONTACT_LINK_FIELDS) {
		if (links[field] === undefined) delete doc[field];
		else doc[field] = links[field];
	}
	const put = await couchReq('PUT', path, { ...doc, updated_at: new Date().toISOString() });
	if (put.status >= 400) throw new Error(`restore contact links failed (HTTP ${put.status})`);
}

// ---------------------------------------------------------------- central queue (Mongo)

/**
 * FastAPI the staff-only queue endpoints are reached on. The app has no browser-facing
 * route for hard-delete / SA list (back-office reads them server-side), so teardown talks to
 * FastAPI directly with the CouchDB admin session — the same identity FastAPI resolves via
 * `GET /_session`. Override when FastAPI is not on the default compose port.
 */
const fastapiBase = () =>
	(process.env.E2E_FASTAPI_URL ?? 'http://localhost:9000').replace(/\/$/, '');

async function adminFastapi(method: 'GET' | 'DELETE', path: string): Promise<Response> {
	const { cookie } = await bootstrapAdminSession();
	return fetch(`${fastapiBase()}${path}`, {
		method,
		headers: { Cookie: `AuthSession=${cookie}`, Accept: 'application/json' }
	});
}

interface QueueListItem {
	id: string;
	open_members: { first_name: string; last_name: string }[];
}

/**
 * Open central-queue registrations that belong to `marker`: the server-side `q` filter is a
 * loose substring / digit match (it also hits other people's phones and ID numbers), so the
 * result is narrowed to registrations with an open member whose last name contains `marker`.
 * Never delete from the unfiltered list.
 */
export async function listUnassignedRegistrations(marker: string): Promise<string[]> {
	const res = await adminFastapi(
		'GET',
		`/staff/v1/unassigned-registrations?q=${encodeURIComponent(marker)}&limit=200`
	);
	if (!res.ok) throw new Error(`list unassigned registrations HTTP ${res.status}`);
	const { items } = (await res.json()) as { items: QueueListItem[] };
	return items
		.filter((i) => i.open_members.some((m) => (m.last_name ?? '').includes(marker)))
		.map((i) => i.id);
}

/** Detail of one queue document (system-admin), or `null` when it no longer exists. */
export async function getUnassignedRegistration(
	id: string
): Promise<Record<string, unknown> | null> {
	const res = await adminFastapi(
		'GET',
		`/staff/v1/unassigned-registrations/${encodeURIComponent(id)}`
	);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`get unassigned registration ${id} HTTP ${res.status}`);
	return (await res.json()) as Record<string, unknown>;
}

/** Hard-delete one queue document (FR-UR-04). 404 counts as already gone. */
export async function deleteUnassignedRegistration(id: string): Promise<void> {
	const res = await adminFastapi(
		'DELETE',
		`/staff/v1/unassigned-registrations/${encodeURIComponent(id)}`
	);
	if (!res.ok && res.status !== 404) {
		throw new Error(`delete unassigned registration ${id} HTTP ${res.status}`);
	}
}

// ---------------------------------------------------------------- created-data ledger

/**
 * Everything a run creates is written here the moment it exists. Playwright restarts the
 * worker after a failed serial test, which wipes module state — the ledger survives that (and
 * a crashed run), so the next teardown deletes exactly the ids this suite created, never
 * anything found by searching.
 */
const LEDGER_PATH = 'node_modules/.cache/pre-register-e2e-created.json';

interface Ledger {
	queue: string[];
	shelters: string[];
}

function readLedger(): Ledger {
	try {
		const raw = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Partial<Ledger>;
		return { queue: raw.queue ?? [], shelters: raw.shelters ?? [] };
	} catch {
		return { queue: [], shelters: [] };
	}
}

function writeLedger(ledger: Ledger): void {
	mkdirSync(dirname(LEDGER_PATH), { recursive: true });
	writeFileSync(LEDGER_PATH, JSON.stringify(ledger));
}

export function recordCreatedQueueId(id: string): void {
	const ledger = readLedger();
	if (!ledger.queue.includes(id)) writeLedger({ ...ledger, queue: [...ledger.queue, id] });
}

export function recordCreatedShelter(code: string): void {
	const ledger = readLedger();
	if (!ledger.shelters.includes(code)) {
		writeLedger({ ...ledger, shelters: [...ledger.shelters, code] });
	}
}

/**
 * Delete everything the ledger (plus `extraQueueIds`) lists, and the registrations that
 * carry this run's `marker`, then empty the ledger. Shelters go through `teardownShelter`,
 * which refuses anything that is not an `E2E …` shelter.
 *
 * On a remote target without `E2E_FASTAPI_URL` the central queue is unreachable: the marker
 * sweep is skipped when nothing was queued (suites that never touch the queue, e.g. onsite),
 * and a run that did queue documents fails loudly rather than leave them behind silently.
 */
export async function purgeCreatedData(
	marker: string,
	extraQueueIds: Iterable<string> = []
): Promise<{ queue: string[]; shelters: string[] }> {
	const ledger = readLedger();
	const queue = new Set<string>([...ledger.queue, ...extraQueueIds]);
	const queueReachable = !IS_REMOTE || Boolean(process.env.E2E_FASTAPI_URL);
	if (!queueReachable && queue.size > 0) {
		throw new Error(
			`E2E_FASTAPI_URL is not set — cannot delete central-queue documents ${[...queue].join(', ')}`
		);
	}
	if (queueReachable) {
		for (const id of await listUnassignedRegistrations(marker)) queue.add(id);
	}
	for (const id of queue) await deleteUnassignedRegistration(id);
	for (const code of ledger.shelters) await teardownShelter(code);
	writeLedger({ queue: [], shelters: [] });
	return { queue: [...queue], shelters: ledger.shelters };
}
