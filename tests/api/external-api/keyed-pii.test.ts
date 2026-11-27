/**
 * What an agency key reads about people: an `/external/v1/occupants` hit carries only the
 * fields of the contract (the whole national ID is intended there, CR-257 D-6), never medical,
 * screening or contact data; a shelter detail names no evacuee and keeps the partner zone shape.
 * docs/data/api-contract.md §5.1, CR-183, CR-254 D3.
 *
 * UAT-159 (the external plane)
 */
import { expect, test } from '@playwright/test';
import { asAdmin, dbExists, shelterDb } from '../../lib/couch.ts';
import { fastapiTarget, shelterCodes } from '../../lib/env.ts';
import {
	callFastapi,
	errorCode,
	fastapiIsUp,
	issueApiKey,
	revokeApiKey,
	type IssuedKey
} from '../../lib/fastapi.ts';
import { FAMILY_MEMBER_FIELDS, OCCUPANT_RESULT_FIELDS, SHELTER_ZONE_FIELDS } from './endpoints.ts';

const RUN = Date.now().toString(36);
const { a: SHELTER } = shelterCodes();

interface Evacuee {
	_id: string;
	first_name?: string;
	last_name?: string;
}

interface SearchBody {
	results: Record<string, unknown>[];
	count: number;
}

let key: IssuedKey;
/** Seeded people staying in the shelter (CouchDB), read once. */
let staying: Evacuee[] = [];

const extraFields = (row: Record<string, unknown>, allowed: readonly string[]) =>
	Object.keys(row).filter((k) => !allowed.includes(k));

function search(text: string) {
	return callFastapi<SearchBody>('/external/v1/occupants', {
		method: 'POST',
		headers: { 'X-API-Key': key.api_key },
		body: { search: text }
	});
}

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
	test.skip(
		!(await dbExists(shelterDb(SHELTER))),
		`${shelterDb(SHELTER)} is missing: run \`pnpm seed\` in frontend/ first`
	);
	key = await issueApiKey(`PERMTEST external pii ${RUN}`);
	const found = await asAdmin<{ docs: Evacuee[] }>('POST', `/${shelterDb(SHELTER)}/_find`, {
		selector: { type: 'evacuee', 'current_stay.status': 'active' },
		fields: ['_id', 'first_name', 'last_name'],
		limit: 10
	});
	staying = (found.body.docs ?? []).filter((d) => d.first_name && d.last_name);
});

test.afterAll(async () => {
	if (key) await revokeApiKey(key.id).catch(() => undefined);
});

test('an occupant hit carries only contract fields', async () => {
	test.skip(staying.length === 0, `no seeded evacuee is staying in ${SHELTER}`);
	// The first seeded person the public projection has picked up (the worker may lag, or a
	// person may have opted out of search).
	let hits: Record<string, unknown>[] = [];
	for (const person of staying) {
		const res = await search(`${person.first_name} ${person.last_name}`);
		expect(res.status, `search (code ${errorCode(res.body)})`).toBe(200);
		expect(res.headers['cache-control']).toBe('no-store');
		if (res.body.count > 0) {
			hits = res.body.results;
			break;
		}
	}
	expect(
		hits.length,
		`one of ${staying.length} seeded people in ${SHELTER} is found`
	).toBeGreaterThan(0);
	for (const hit of hits) {
		expect(extraFields(hit, OCCUPANT_RESULT_FIELDS), 'fields outside the contract').toEqual([]);
		for (const member of (hit.family_members ?? []) as Record<string, unknown>[]) {
			expect(extraFields(member, FAMILY_MEMBER_FIELDS), 'family member fields').toEqual([]);
		}
	}
});

test('a search shorter than the rule is refused, not answered', async () => {
	const res = await search('ก');
	expect(res.status).toBe(422);
});

test('a shelter detail names no evacuee and keeps the partner zone shape', async () => {
	const res = await callFastapi<{ shelter: Record<string, unknown> }>(
		`/external/v1/shelters/${encodeURIComponent(SHELTER)}`,
		{ headers: { 'X-API-Key': key.api_key } }
	);
	expect(res.status, `shelter ${SHELTER} (code ${errorCode(res.body)})`).toBe(200);
	for (const zone of (res.body.shelter.zones ?? []) as Record<string, unknown>[]) {
		expect(extraFields(zone, SHELTER_ZONE_FIELDS), 'zone fields (CR-254 D3)').toEqual([]);
	}
	const text = JSON.stringify(res.body);
	for (const person of staying) {
		// Boolean only: a failing assertion must not print the name.
		expect(
			text.includes(`${person.first_name} ${person.last_name}`),
			`shelter detail does not name evacuee ${person._id}`
		).toBe(false);
	}
});
