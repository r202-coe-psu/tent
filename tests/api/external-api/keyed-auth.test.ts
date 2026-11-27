/**
 * The keyed external plane lets in only a live managed API key: no key, a made-up key, the BFF's
 * own `EXTERNAL_API_SECRET`, a revoked key — all 401. A live key works in either header.
 * docs/data/api-contract.md §5.1, CR-062.
 *
 * UAT-142 (the revoke half, on the server)
 */
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { fastapiTarget, shelterCodes } from '../../lib/env.ts';
import {
	callFastapi,
	errorCode,
	fastapiIsUp,
	issueApiKey,
	listApiKeys,
	revokeApiKey,
	type ApiResult,
	type IssuedKey
} from '../../lib/fastapi.ts';
import { KEYED_ENDPOINTS, type KeyedEndpoint } from './endpoints.ts';

const RUN = Date.now().toString(36);
const { a: SHELTER } = shelterCodes();

let liveKey: IssuedKey;
const issued: string[] = [];

async function issue(label: string): Promise<IssuedKey> {
	const key = await issueApiKey(`PERMTEST external ${label} ${RUN}`);
	issued.push(key.id);
	return key;
}

function call(endpoint: KeyedEndpoint, headers: Record<string, string>): Promise<ApiResult> {
	return callFastapi(endpoint.path(SHELTER), {
		method: endpoint.method,
		headers,
		body: endpoint.body
	});
}

function expectRefused(res: ApiResult, label: string): void {
	expect(res.status, label).toBe(401);
	expect(errorCode(res.body), `${label}: error code`).toBe('unauthorized');
	expect(res.headers['www-authenticate'], `${label}: challenge`).toBe('Bearer');
}

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
	liveKey = await issue('live');
});

test.afterAll(async () => {
	for (const id of issued.splice(0)) await revokeApiKey(id).catch(() => undefined);
});

test('every endpoint refuses a request with no key', async () => {
	for (const endpoint of KEYED_ENDPOINTS) {
		expectRefused(await call(endpoint, {}), `${endpoint.name} without a key`);
	}
});

test('every endpoint refuses a key it did not issue', async () => {
	// Right shape (`tsk_` + random), but no such key; and a value without the `tsk_` prefix.
	const madeUp = `tsk_${randomBytes(32).toString('base64url')}`;
	for (const endpoint of KEYED_ENDPOINTS) {
		expectRefused(await call(endpoint, { 'X-API-Key': madeUp }), `${endpoint.name}, made-up key`);
		expectRefused(
			await call(endpoint, { Authorization: 'Bearer not-a-key' }),
			`${endpoint.name}, not a key`
		);
	}
});

test('the BFF secret does not open the keyed plane', async () => {
	// EXTERNAL_API_SECRET opens /public/v1 and /v1/admin for the BFF; it is not an agency key.
	const { adminSecret } = fastapiTarget();
	for (const endpoint of KEYED_ENDPOINTS) {
		expectRefused(
			await call(endpoint, { Authorization: `Bearer ${adminSecret}` }),
			`${endpoint.name} with the BFF secret`
		);
	}
});

test('a live key opens every endpoint, in X-API-Key or as Bearer', async () => {
	for (const endpoint of KEYED_ENDPOINTS) {
		for (const [how, headers] of [
			['X-API-Key', { 'X-API-Key': liveKey.api_key }],
			['Bearer', { Authorization: `Bearer ${liveKey.api_key}` }]
		] as const) {
			const res = await call(endpoint, headers);
			expect(
				res.status,
				`${endpoint.name} with the key in ${how} (code ${errorCode(res.body)})`
			).toBe(200);
			if (endpoint.cacheControl) {
				expect(res.headers['cache-control'], `${endpoint.name}: Cache-Control`).toBe(
					endpoint.cacheControl
				);
			}
		}
	}
});

test('a used key shows when it was last used, and the list never shows the secret', async () => {
	await call(KEYED_ENDPOINTS[1], { 'X-API-Key': liveKey.api_key });
	const list = await listApiKeys();
	expect(list.status).toBe(200);
	const row = list.body.keys.find((k) => k.id === liveKey.id);
	expect(row, 'the issued key is listed').toBeDefined();
	expect(row?.last_used_at, 'last_used_at is stamped on use').not.toBeNull();
	expect(row?.key_prefix, 'only the prefix is listed').toBe(liveKey.api_key.slice(0, 8));
	// Booleans only: a failing assertion must not print the secret.
	const text = JSON.stringify(list.body);
	expect(text.includes(liveKey.api_key), 'the list does not contain the secret').toBe(false);
	expect(text.includes('key_hash'), 'the list does not carry the hash').toBe(false);
});

test('a revoked key is refused on its next call', async () => {
	// Unlike a partner JWT (issue #746), the key is looked up on every call: revoke is immediate.
	const key = await issue('revoked');
	const needs = KEYED_ENDPOINTS[1];
	expect((await call(needs, { 'X-API-Key': key.api_key })).status, 'before revoke').toBe(200);
	await revokeApiKey(key.id);
	for (const endpoint of KEYED_ENDPOINTS) {
		const res = await call(endpoint, { 'X-API-Key': key.api_key });
		expectRefused(res, `${endpoint.name} after revoke`);
		expect(JSON.stringify(res.body)).toContain('revoked');
	}
});

test('a key cannot be issued already expired', async () => {
	const res = await callFastapi('/v1/admin/api-keys', {
		method: 'POST',
		headers: { Authorization: `Bearer ${fastapiTarget().adminSecret}` },
		body: {
			name: `PERMTEST external expired ${RUN}`,
			owner: 'PERMTEST',
			expires_at: new Date(Date.now() - 60_000).toISOString(),
			created_by: 'permtest'
		}
	});
	expect(res.status).toBe(422);
});
