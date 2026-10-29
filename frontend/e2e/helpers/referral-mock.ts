/**
 * Mocked staff shell + referral BFF for the @regression referral suites.
 *
 * Nothing here touches CouchDB: the session check and the CouchDB reads the page
 * makes (registry / evacuee lists, _changes) are answered by `page.route`, and the
 * `/api/back-office/referral*` BFF is served from an in-test store. Fixtures are
 * schema-valid (`referralReadSchema`), otherwise `list()` silently drops rows.
 */
import type { Page, Route } from '@playwright/test';
import { COUCH_BASE } from './couch';
import { appBaseUrl } from './e2e-env';

export const MOCK_SHELTER = 'SH001';
export const MOCK_DEST = 'SH002';
const MOCK_USER = 'ref_mock_manager';

export type ReferralRow = Record<string, unknown> & { _id: string; status: string };

export interface ReferralStore {
	referrals: Record<string, ReferralRow>;
	/** Make GET /api/back-office/referral return 500. */
	listFail: boolean;
	/** Make GET /api/back-office/referral return 500 only for bookmark (load-more) requests. */
	pageFail: boolean;
	/** Make GET /api/back-office/referral/:id return 500. */
	detailFail: boolean;
	/** Make GET /api/back-office/referral/:id/batch return 500. */
	batchFail: boolean;
	/** Name snapshot the BFF writes as `evacuee_summary` on create, by evacuee id. */
	evacueeSummaries: Record<string, { first_name: string; last_name: string }>;
	/** Evacuee ids whose POST create is answered with a 500. */
	createFailIds: string[];
	/** Every GET of a batch the page made (anchor ids), in order. */
	batchReads: string[];
	/** Every PATCH transition the page sent, in order. */
	patches: { id: string; body: { to: string; reason?: string } }[];
	/** Referral ids that POST bulk-transition reports as failed (per-item error, others succeed). */
	bulkFailIds: string[];
	/** Every POST bulk-transition the page sent, in order. */
	bulkCalls: { ids: string[]; to: string; reason?: string }[];
	/** When set, PATCH waits on this promise before answering (in-flight window). */
	patchGate?: Promise<unknown>;
	/** Every non-GET request the page made to the BFF or CouchDB. */
	writes: string[];
}

export function newReferralStore(rows: ReferralRow[] = []): ReferralStore {
	return {
		referrals: Object.fromEntries(rows.map((r) => [r._id, r])),
		listFail: false,
		pageFail: false,
		detailFail: false,
		batchFail: false,
		evacueeSummaries: {},
		createFailIds: [],
		batchReads: [],
		bulkFailIds: [],
		bulkCalls: [],
		patches: [],
		writes: []
	};
}

/** A schema-valid referral (`referralReadSchema`). Defaults to an outgoing capacity referral. */
export function referralFixture(overrides: Partial<ReferralRow> & { _id: string }): ReferralRow {
	const stamp = '2026-10-14T08:00:00.000Z';
	return {
		type: 'referral',
		schema_v: 1,
		referral_type: 'capacity',
		shelter_code: MOCK_SHELTER,
		to_shelter_code: MOCK_DEST,
		evacuee_id: 'evacuee:mock_01',
		evacuee_summary: { first_name: 'สมชาย', last_name: 'ทดสอบ' },
		reason: 'ศูนย์เต็ม',
		urgency: 'normal',
		status: 'sent',
		timeline: { sent: { at: stamp, by: MOCK_USER } },
		created_at: stamp,
		updated_at: stamp,
		created_by: MOCK_USER,
		...overrides
	} as ReferralRow;
}

/** Serve a staff session (no real CouchDB user) for the given shelter roles. */
export async function mockStaffSession(
	page: Page,
	shelter: string,
	evacuees: Record<string, unknown>[] = []
): Promise<void> {
	const roles = [`shelter:${shelter}`, 'shelter_manager'];
	const appBase = appBaseUrl();
	await page.route(
		(url) => url.pathname === '/api/v1/auth/me',
		(route) =>
			route.fulfill({
				json: {
					username: MOCK_USER,
					roles,
					must_change_password: false,
					has_security_question: true,
					pending_mfa: false,
					display_name: 'ผู้จัดการทดสอบ'
				}
			})
	);
	await page.route(`${COUCH_BASE}/**`, async (route: Route) => {
		const req = route.request();
		const cors = {
			'access-control-allow-origin': appBase,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers': 'Content-Type, Accept'
		};
		if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
		const path = new URL(req.url()).pathname;
		if (path === '/_session') {
			return route.fulfill({
				headers: cors,
				json: { ok: true, userCtx: { name: MOCK_USER, roles }, info: {} }
			});
		}
		if (path.endsWith('/_changes')) {
			// Long-poll: hold the request open like CouchDB does, instead of spinning.
			await new Promise((resolve) => setTimeout(resolve, 5000));
			return route.fulfill({
				headers: cors,
				json: { results: [], last_seq: 'now', pending: 0 }
			});
		}
		return route.fulfill({
			headers: cors,
			json: couchReadResponse(path, new URL(req.url()).searchParams, evacuees)
		});
	});
}

/**
 * Read answers for CouchDB paths the page polls. The registry must list the active shelter,
 * or the page shows "no shelter"; every other collection is empty.
 */
function couchReadResponse(
	path: string,
	params: URLSearchParams,
	evacuees: Record<string, unknown>[]
): Record<string, unknown> {
	if (path === '/registry/_all_docs') {
		const docs = [MOCK_SHELTER, MOCK_DEST].map((code) => ({
			_id: `shelter:${code}`,
			_rev: '1-mock',
			type: 'shelter',
			schema_v: 4,
			code,
			name: `Mock shelter ${code}`,
			operation_status: 'open'
		}));
		return {
			total_rows: docs.length,
			offset: 0,
			rows: docs.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: '1-mock' }, doc }))
		};
	}
	// Evacuee roster (`_all_docs` by the `evacuee:` prefix) of the active shelter's DB.
	if (path.endsWith('/_all_docs') && params.get('startkey')?.includes('evacuee:')) {
		const rows = evacuees.map((doc) => ({
			id: doc._id,
			key: doc._id,
			value: { rev: '1-mock' },
			doc
		}));
		return { total_rows: rows.length, offset: 0, rows };
	}
	return { total_rows: 0, offset: 0, rows: [], docs: [] };
}

/**
 * Mirror of the BFF list contract: filter by direction/status (relative to `shelter_code`),
 * newest first, page by an opaque bookmark (the offset). Responds `{ items, bookmark, has_more }`.
 */
function listPage(store: ReferralStore, params: URLSearchParams) {
	const shelter = params.get('shelter_code');
	const direction = params.get('direction');
	const status = params.get('status');
	const limit = Number(params.get('limit') ?? 50);
	const offset = Number(params.get('bookmark') ?? 0);
	const rows = Object.values(store.referrals)
		.filter((r) => {
			if (direction === 'outgoing') return r.shelter_code === shelter;
			if (direction === 'incoming') return r.to_shelter_code === shelter;
			return r.shelter_code === shelter || r.to_shelter_code === shelter;
		})
		.filter((r) => !status || r.status === status)
		.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
	const items = rows.slice(offset, offset + limit);
	return { items, bookmark: String(offset + items.length), has_more: items.length === limit };
}

const BUCKET_MS = 2 * 60 * 1000;

/** Mirror of the batch contract: siblings with the same template + creator in the same 2-minute bucket. */
function batchOf(store: ReferralStore, anchor: ReferralRow): ReferralRow[] {
	const key = (r: ReferralRow) =>
		[
			r.shelter_code,
			r.created_by,
			r.referral_type,
			r.reason,
			r.urgency,
			r.notes ?? '',
			r.to_shelter_code ?? '',
			JSON.stringify(r.to_org ?? null),
			Math.floor(new Date(String(r.created_at)).getTime() / BUCKET_MS)
		].join('|');
	const k = key(anchor);
	return Object.values(store.referrals)
		.filter((r) => key(r) === k)
		.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

let createdCount = 0;

/** Serve the referral BFF from `store`. Records every non-GET request in `store.writes`. */
export async function mockReferralApi(page: Page, store: ReferralStore): Promise<void> {
	page.on('request', (req) => {
		if (req.method() !== 'GET' && req.url().includes('/api/back-office/referral')) {
			store.writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
		}
	});
	await page.route(
		(url) => url.pathname.startsWith('/api/back-office/referral'),
		async (route: Route) => {
			const req = route.request();
			const path = new URL(req.url()).pathname;
			if (path === '/api/back-office/referral') {
				if (req.method() === 'POST') {
					const body = req.postDataJSON() as Record<string, unknown> & { evacuee_id: string };
					if (store.createFailIds.includes(body.evacuee_id)) {
						return route.fulfill({ status: 500, json: { error: 'mock create failure' } });
					}
					createdCount += 1;
					// Fixed bucket: every doc of one test's create batch shares a 2-minute window.
					const created_at = new Date(Date.UTC(2026, 9, 14, 9, 0, createdCount % 60)).toISOString();
					const doc = referralFixture({
						...body,
						...(store.evacueeSummaries[body.evacuee_id]
							? { evacuee_summary: store.evacueeSummaries[body.evacuee_id] }
							: {}),
						_id: `referral:mock_created_${createdCount}`,
						status: 'draft',
						timeline: {},
						created_at,
						updated_at: created_at
					});
					store.referrals[doc._id] = doc;
					return route.fulfill({ status: 201, json: doc });
				}
				if (req.method() !== 'GET') {
					return route.fulfill({ status: 500, json: { error: 'unexpected write in mock' } });
				}
				if (store.listFail)
					return route.fulfill({ status: 500, json: { error: 'mock list failure' } });
				if (store.pageFail && new URL(req.url()).searchParams.has('bookmark'))
					return route.fulfill({ status: 500, json: { error: 'mock page failure' } });
				return route.fulfill({ json: listPage(store, new URL(req.url()).searchParams) });
			}
			if (path === '/api/back-office/referral/bulk-transition') {
				if (req.method() !== 'POST') return route.fallback();
				const body = req.postDataJSON() as { ids: string[]; to: string; reason?: string };
				store.bulkCalls.push(body);
				const succeeded: ReferralRow[] = [];
				const failed: { id: string; error: string }[] = [];
				for (const id of body.ids) {
					const current = store.referrals[id];
					if (!current || store.bulkFailIds.includes(id)) {
						failed.push({ id, error: current ? 'mock bulk failure' : 'not found' });
						continue;
					}
					const next: ReferralRow = {
						...current,
						status: body.to,
						updated_at: new Date().toISOString(),
						...(body.reason ? { close_reason: body.reason } : {})
					};
					store.referrals[id] = next;
					succeeded.push(next);
				}
				return route.fulfill({ json: { succeeded, failed } });
			}
			const match = path.match(/^\/api\/back-office\/referral\/([^/]+)(\/transition|\/batch)?$/);
			if (!match) return route.fallback();
			const id = decodeURIComponent(match[1]);
			const current = store.referrals[id];
			if (match[2] === '/batch') {
				if (req.method() !== 'GET') return route.fallback();
				store.batchReads.push(id);
				if (store.batchFail)
					return route.fulfill({ status: 500, json: { error: 'mock batch failure' } });
				if (!current) return route.fulfill({ status: 404, json: { error: 'not found' } });
				return route.fulfill({ json: { items: batchOf(store, current) } });
			}
			if (match[2]) {
				if (req.method() !== 'PATCH') return route.fallback();
				const body = req.postDataJSON() as { to: string; reason?: string };
				store.patches.push({ id, body });
				if (store.patchGate) await store.patchGate;
				if (!current) return route.fulfill({ status: 404, json: { error: 'not found' } });
				const next: ReferralRow = {
					...current,
					status: body.to,
					updated_at: new Date().toISOString(),
					...(body.reason ? { response_reason: body.reason } : {})
				};
				store.referrals[id] = next;
				return route.fulfill({ json: next });
			}
			if (req.method() !== 'GET') return route.fallback();
			if (store.detailFail)
				return route.fulfill({ status: 500, json: { error: 'mock detail failure' } });
			if (!current) return route.fulfill({ status: 404, json: { error: 'not found' } });
			return route.fulfill({ json: current });
		}
	);
}
