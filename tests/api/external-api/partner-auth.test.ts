/**
 * Partner plane sign-in: `/external/token` only issues a token for a live client with its own
 * secret, and every EXT endpoint lets in only a token the server signed itself and that has not
 * expired. Admin lifecycle of a client (regenerate secret, edit scopes, revoke, delete) and what
 * each step does to minting. docs/data/api-contract.md §5.3, ADR 0002 §6, EXT-001.
 *
 * UAT-142
 */
import { expect, test } from '@playwright/test';
import { fastapiTarget, shelterCodes } from '../../lib/env.ts';
import { fastapiIsUp, type ApiResult } from '../../lib/fastapi.ts';
import {
	PARTNER_SCOPES,
	PartnerClients,
	adminClients,
	callExt,
	claims,
	extCode,
	fictitiousCid,
	mintToken,
	postToken,
	signJwt,
	unsignedJwt,
	wrongKey,
	type PartnerClient,
	type PartnerClientMeta
} from '../../lib/partner.ts';
import { BOOKING_CREATE, PARTNER_ENDPOINTS, type PartnerCtx } from './partner-endpoints.ts';

const RUN = Date.now().toString(36);
const clients = new PartnerClients(RUN);
const ctx = (): PartnerCtx => ({
	code: shelterCodes().a,
	bookingId: 'bk_permtest_none',
	cid: fictitiousCid()
});

function expectRefused(res: ApiResult, label: string, code = 'invalid_token'): void {
	expect(res.status, `${label} (code ${extCode(res)})`).toBe(401);
	expect(extCode(res), `${label}: error code`).toBe(code);
}

/** Every EXT route, EXT-008 included (a refused token never reaches the booking code). */
async function sweep(token: string | null, label: string, code = 'invalid_token') {
	for (const e of PARTNER_ENDPOINTS) {
		const c = ctx();
		const res = await callExt(token, e.path(c), {
			method: e.method,
			query: e.query?.(c),
			body: e.body?.(c)
		});
		expectRefused(res, `${e.ext} ${label}`, code);
		expect(res.headers['www-authenticate'], `${e.ext} ${label}: challenge`).toBe('Bearer');
	}
	const res = await callExt(token, BOOKING_CREATE.path, {
		method: 'POST',
		body: { location_code: shelterCodes().a, persons: [{ cid: fictitiousCid() }] }
	});
	expectRefused(res, `${BOOKING_CREATE.ext} ${label}`, code);
}

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
});

test.afterAll(async () => {
	await clients.cleanup();
});

test.describe('EXT-001 /external/token', () => {
	let client: PartnerClient;

	test.beforeAll(async () => {
		client = await clients.create('token', ['location-read', 'occupancy-read'], 'M6');
	});

	test('issues a Bearer JWT carrying exactly the client scopes and module', async () => {
		const token = await mintToken(client.client_id, client.client_secret);
		expect(token.token_type).toBe('Bearer');
		expect(token.expires_in).toBe(3600);
		expect(token.module_name).toBe('M6');
		expect(token.scopes.slice().sort()).toEqual(['location-read', 'occupancy-read']);
		expect(/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token.access_token), 'three-part JWT').toBe(true);
	});

	test('refuses a wrong secret, an unknown client and the same message for both', async () => {
		const wrong = await postToken({
			grant_type: 'client_credentials',
			client_id: client.client_id,
			client_secret: 'permtest-wrong-secret'
		});
		const unknown = await postToken({
			grant_type: 'client_credentials',
			client_id: 'tpc_permtest_does_not_exist',
			client_secret: 'permtest'
		});
		expectRefused(wrong, 'wrong secret', 'invalid_client');
		expectRefused(unknown, 'unknown client', 'invalid_client');
		// No enumeration: the two answers cannot be told apart.
		expect(wrong.body).toEqual(unknown.body);
	});

	test('refuses another grant type, a form body and a missing field', async () => {
		const grant = await postToken({
			grant_type: 'password',
			client_id: client.client_id,
			client_secret: client.client_secret
		});
		expect(grant.status).toBe(400);
		expect(extCode(grant)).toBe('unsupported_grant_type');

		const form = await fetch(`${fastapiTarget().base}/external/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: client.client_id,
				client_secret: client.client_secret
			})
		});
		expect(form.status, 'JSON only').toBe(422);

		const missing = await postToken({ grant_type: 'client_credentials', client_id: 'x' });
		expect(missing.status).toBe(422);
	});
});

test.describe('bearer token on every EXT endpoint', () => {
	test('no token, garbage, a token signed with another key, or alg none is refused', async () => {
		await sweep(null, 'without a token');
		await sweep('not.a.jwt', 'with garbage');
		await sweep(signJwt(claims(PARTNER_SCOPES), wrongKey()), 'signed with another key');
		await sweep(unsignedJwt(claims(PARTNER_SCOPES)), 'with alg none');
	});

	test('the BFF secret and an /external/v1 style key are not partner tokens', async () => {
		await sweep(fastapiTarget().adminSecret, 'with the BFF secret');
		await sweep(`tsk_${'a'.repeat(43)}`, 'with an API key');
	});

	test('an expired token signed with the real key is refused', async () => {
		const key = process.env.THIRDPARTY_JWT_SIGNING_KEY?.trim();
		test.skip(!key, 'THIRDPARTY_JWT_SIGNING_KEY is not set: cannot sign a token as the server');
		const expired = signJwt(claims(PARTNER_SCOPES, -60), key!);
		const res = await callExt(expired, '/external/locations');
		expectRefused(res, 'expired');
		expect(JSON.stringify(res.body)).toContain('expired');
		// Control: the same key with a live expiry is accepted, so the refusal is the expiry.
		expect(
			(await callExt(signJwt(claims(PARTNER_SCOPES), key!), '/external/locations')).status
		).toBe(200);
	});
});

test.describe('client lifecycle (admin API)', () => {
	test('regenerate secret: the old secret stops minting at once, the new one works', async () => {
		const client = await clients.create('regen', ['location-read']);
		const regen = await adminClients<PartnerClient>('POST', `/${client.id}/regenerate-secret`);
		expect(regen.status).toBe(200);
		expect(regen.body.client_id, 'same client id').toBe(client.client_id);
		expect(regen.body.client_secret === client.client_secret, 'a new secret').toBe(false);

		expectRefused(
			await postToken({
				grant_type: 'client_credentials',
				client_id: client.client_id,
				client_secret: client.client_secret
			}),
			'old secret',
			'invalid_client'
		);
		await mintToken(client.client_id, regen.body.client_secret);

		const reveal = await adminClients<{ client_secret: string }>('GET', `/${client.id}/secret`);
		expect(reveal.status).toBe(200);
		expect(reveal.body.client_secret === regen.body.client_secret, 'reveal shows the new one').toBe(
			true
		);
	});

	test('editing scopes changes the next token, not the one already issued', async () => {
		const client = await clients.create('scopes', ['location-read', 'location-stock-read']);
		const before = (await mintToken(client.client_id, client.client_secret)).access_token;
		const patch = await adminClients<PartnerClientMeta>('PATCH', `/${client.id}`, {
			allowed_scopes: ['location-read']
		});
		expect(patch.status).toBe(200);
		expect(patch.body.allowed_scopes).toEqual(['location-read']);

		const after = await mintToken(client.client_id, client.client_secret);
		expect(after.scopes).toEqual(['location-read']);
		const stockPath = `/external/locations/${shelterCodes().a}/stock`;
		expect((await callExt(after.access_token, stockPath)).status, 'new token').toBe(403);
		// ADR 0002 §6: the JWT is trusted without a DB lookup until it expires (issue #746).
		expect((await callExt(before, stockPath)).status, 'token issued before the edit').toBe(200);
	});

	test('a scope outside the nine and an unknown module are refused', async () => {
		const bad = await adminClients('POST', '', {
			name: `PERMTEST partner bad ${RUN}`,
			allowed_scopes: ['admin']
		});
		expect(bad.status).toBe(422);
		const module = await adminClients('POST', '', {
			name: `PERMTEST partner badmod ${RUN}`,
			module_name: 'M99',
			allowed_scopes: ['location-read']
		});
		expect(module.status).toBe(422);
		const none = await adminClients('POST', '', {
			name: `PERMTEST partner noscope ${RUN}`,
			allowed_scopes: []
		});
		expect(none.status).toBe(422);
	});

	test('revoke stops minting; a revoked client cannot be edited or regenerated', async () => {
		const client = await clients.create('revoke', ['location-read']);
		const live = (await mintToken(client.client_id, client.client_secret)).access_token;
		const revoke = await adminClients<{ client: PartnerClientMeta }>(
			'POST',
			`/${client.id}/revoke`
		);
		expect(revoke.status).toBe(200);
		expect(revoke.body.client.is_active).toBe(false);

		expectRefused(
			await postToken({
				grant_type: 'client_credentials',
				client_id: client.client_id,
				client_secret: client.client_secret
			}),
			'revoked client',
			'invalid_client'
		);
		expect(
			(await adminClients('PATCH', `/${client.id}`, { allowed_scopes: ['location-read'] })).status
		).toBe(409);
		expect((await adminClients('POST', `/${client.id}/regenerate-secret`)).status).toBe(409);
		// ADR 0002 §6 / issue #746: a token issued before the revoke lives until it expires.
		expect((await callExt(live, '/external/locations')).status, 'token from before revoke').toBe(
			200
		);
	});

	test('delete is refused for a live client and soft-deletes a revoked one', async () => {
		const client = await clients.create('delete', ['location-read']);
		expect((await adminClients('DELETE', `/${client.id}`)).status, 'live client').toBe(409);
		await adminClients('POST', `/${client.id}/revoke`);
		const del = await adminClients<{ client: PartnerClientMeta }>('DELETE', `/${client.id}`);
		expect(del.status).toBe(200);
		expect(del.body.client.deleted_at).not.toBeNull();
		const list = await adminClients<{ clients: PartnerClientMeta[] }>('GET');
		expect(
			list.body.clients.some((c) => c.id === client.id),
			'gone from the list'
		).toBe(false);
		// Soft delete: the client id stays unusable.
		expectRefused(
			await postToken({
				grant_type: 'client_credentials',
				client_id: client.client_id,
				client_secret: client.client_secret
			}),
			'deleted client',
			'invalid_client'
		);
	});

	test('the list never carries a secret or its hash', async () => {
		const client = await clients.create('list', ['location-read']);
		const list = await adminClients<{ clients: PartnerClientMeta[] }>('GET');
		expect(list.status).toBe(200);
		const text = JSON.stringify(list.body);
		expect(text.includes(client.client_secret), 'no plaintext secret').toBe(false);
		expect(/secret_hash|secret_ciphertext|client_secret/.test(text), 'no secret fields').toBe(
			false
		);
	});
});
