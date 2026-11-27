/**
 * Through the public edge (nginx/nginx.conf), outsiders reach FastAPI only under `/external/`.
 * `/v1/admin/*` and `/public/v1/*` stay behind the BFF even for a caller that holds the BFF
 * secret, and the internal worker routes are blocked. CR-062, CR-063, CR-126, CR-243.
 *
 * Runs only when `EDGE_BASE_URL` points at an nginx built from nginx/nginx.conf (staging, or a
 * local container: see README). Without it every test is skipped.
 */
import { expect, test } from '@playwright/test';
import { fastapiTarget } from '../../lib/env.ts';
import { fastapiIsUp, issueApiKey, revokeApiKey, type IssuedKey } from '../../lib/fastapi.ts';

const EDGE = process.env.EDGE_BASE_URL?.trim().replace(/\/$/, '');
const RUN = Date.now().toString(36);
let key: IssuedKey | undefined;

async function viaEdge(path: string, init: RequestInit = {}) {
	const res = await fetch(`${EDGE}${path}`, { redirect: 'manual', ...init });
	const text = await res.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		// HTML or plain text: not a FastAPI answer.
	}
	return { status: res.status, json, type: res.headers.get('content-type') ?? '' };
}

/** True when the answer is FastAPI's own JSON for that admin / public route. */
const isFastapiData = (json: unknown) =>
	!!json &&
	typeof json === 'object' &&
	['keys', 'clients', 'items', 'shelters'].some((k) => k in (json as object));

test.beforeAll(async () => {
	test.skip(!EDGE, 'EDGE_BASE_URL is not set: no nginx edge to test');
	test.skip(!(await fastapiIsUp()), `FastAPI is not answering at ${fastapiTarget().base}`);
	key = await issueApiKey(`PERMTEST external edge ${RUN}`);
});

test.afterAll(async () => {
	if (key) await revokeApiKey(key.id).catch(() => undefined);
});

test('/external/ reaches FastAPI: keyed plane and partner token endpoint', async () => {
	const none = await viaEdge('/external/v1/needs');
	expect(none.status, 'no key').toBe(401);
	const ok = await viaEdge('/external/v1/needs', { headers: { 'X-API-Key': key!.api_key } });
	expect(ok.status, 'with a key').toBe(200);
	const token = await viaEdge('/external/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ grant_type: 'password', client_id: 'x', client_secret: 'y' })
	});
	expect(token.status, 'partner token endpoint').toBe(400);
});

test('BFF-only FastAPI routes are not served at the edge, even with the BFF secret', async () => {
	const auth = { Authorization: `Bearer ${fastapiTarget().adminSecret}` };
	for (const path of [
		'/v1/admin/api-keys',
		'/v1/admin/thirdparty-clients',
		'/public/v1/shelters',
		'/public/v1/needs'
	]) {
		const res = await viaEdge(path, { headers: auth });
		expect(isFastapiData(res.json), `${path} is not FastAPI data (HTTP ${res.status})`).toBe(false);
	}
	const create = await viaEdge('/v1/admin/api-keys', {
		method: 'POST',
		headers: { ...auth, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name: `PERMTEST edge ${RUN}`,
			owner: 'PERMTEST',
			expires_at: new Date(Date.now() + 3_600_000).toISOString(),
			created_by: 'permtest'
		})
	});
	expect(create.status, 'no key can be issued through the edge').not.toBe(201);
});

test('internal worker routes and the replication UI are blocked', async () => {
	for (const path of [
		'/api/internal/shelter-import/worker/run',
		'/api/internal/shelter-close/worker/run',
		'/api/internal/printers/housekeeping',
		'/sync/_utils/'
	]) {
		expect((await viaEdge(path)).status, path).toBe(404);
	}
});
