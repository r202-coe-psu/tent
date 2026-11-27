/**
 * The routes only the staff BFF may call — key and partner-client admin (`/v1/admin/*`) and the
 * public plane (`/public/v1/*`, CR-063) — take `EXTERNAL_API_SECRET` and nothing else. An agency
 * that holds a live `/external/v1` key must not reach them with it.
 * docs/data/api-contract.md §5.1, CR-062, CR-063, EXT-001.
 *
 * UAT-142
 */
import { expect, test } from '@playwright/test';
import { fastapiTarget } from '../../lib/env.ts';
import {
	callFastapi,
	fastapiIsUp,
	issueApiKey,
	revokeApiKey,
	type IssuedKey
} from '../../lib/fastapi.ts';

const RUN = Date.now().toString(36);

/** BFF-only routes, read-only on purpose: a gate that failed open must not change anything. */
const BFF_ONLY = [
	'/v1/admin/api-keys',
	'/v1/admin/thirdparty-clients',
	'/public/v1/shelters',
	'/public/v1/needs'
] as const;

let agencyKey: IssuedKey;

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
	agencyKey = await issueApiKey(`PERMTEST external admin-gate ${RUN}`);
});

test.afterAll(async () => {
	if (agencyKey) await revokeApiKey(agencyKey.id).catch(() => undefined);
});

test('the BFF secret opens every BFF-only route', async () => {
	// Control: without it the refusals below could be a broken route, not a closed gate.
	const auth = { Authorization: `Bearer ${fastapiTarget().adminSecret}` };
	for (const path of BFF_ONLY) {
		expect((await callFastapi(path, { headers: auth })).status, path).toBe(200);
	}
});

test('no credential, a wrong secret, or an agency key is refused', async () => {
	const attempts: [string, Record<string, string>][] = [
		['no credential', {}],
		['a wrong secret', { Authorization: 'Bearer permtest-wrong-secret' }],
		['an agency key as Bearer', { Authorization: `Bearer ${agencyKey.api_key}` }],
		['an agency key in X-API-Key', { 'X-API-Key': agencyKey.api_key }]
	];
	for (const path of BFF_ONLY) {
		for (const [label, headers] of attempts) {
			const res = await callFastapi(path, { headers });
			expect(res.status, `${path} with ${label}`).toBe(401);
		}
	}
});

test('an agency key cannot issue another key', async () => {
	const res = await callFastapi('/v1/admin/api-keys', {
		method: 'POST',
		headers: { Authorization: `Bearer ${agencyKey.api_key}` },
		body: {
			name: `PERMTEST external escalation ${RUN}`,
			owner: 'PERMTEST',
			expires_at: new Date(Date.now() + 3_600_000).toISOString(),
			created_by: 'permtest'
		}
	});
	expect(res.status).toBe(401);
});
