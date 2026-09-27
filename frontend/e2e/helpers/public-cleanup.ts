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

import { couchReq } from './couch';
import { appBaseUrl } from './e2e-env';

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
	{ timeoutMs = 90_000, intervalMs = 3_000 } = {}
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check().catch(() => false)) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`Timed out waiting for projection: ${what} (is the sync worker running?)`);
}

/** Public projection status of a shelter code via the BFF, or undefined if absent. */
export async function publicShelterStatus(code: string): Promise<string | undefined> {
	const res = await fetch(`${bffBase()}/shelters`);
	if (!res.ok) throw new Error(`shelters HTTP ${res.status}`);
	const { shelters } = (await res.json()) as { shelters: { code: string; status: string }[] };
	return shelters.find((s) => s.code === code)?.status;
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
		await couchReq('DELETE', `${path}?rev=${rev}`);
	}
	await couchReq('DELETE', `/shelter_${code.toLowerCase()}`);
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
