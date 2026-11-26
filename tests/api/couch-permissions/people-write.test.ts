/**
 * Who may write people-plane docs (evacuee, household, screening, medical) straight to
 * CouchDB in their own shelter — the path a browser takes through `/couch`, with no route
 * guard in between. Expected access comes from ./matrix.ts (role-permission-matrix.md).
 *
 * UAT-045 / UAT-046 · issue #834
 */
import { expect, test } from '@playwright/test';
import {
	asSession,
	createAccount,
	dbExists,
	deleteAccount,
	purgeDocs,
	shelterDb,
	type CouchDoc,
	type TestAccount
} from '../../lib/couch.ts';
import { shelterCodes } from '../../lib/env.ts';
import { KNOWN_GAPS, PEOPLE_DOC_TYPES, SHELTER_ROLES, WRITERS } from './matrix.ts';
import { probeDoc } from './probes.ts';

const RUN = Date.now().toString(36);
const SHELTER = shelterCodes().a;
const DB = shelterDb(SHELTER);

const SCOPE_ONLY = 'scope_only';
const accounts = new Map<string, TestAccount>();
const written: string[] = [];

function accountName(label: string): string {
	return `permtest_${label}_${RUN}`;
}

async function write(account: TestAccount, doc: CouchDoc): Promise<number> {
	const res = await asSession(account.session, 'PUT', `/${DB}/${encodeURIComponent(doc._id)}`, doc);
	if (res.status === 201 || res.status === 202) written.push(doc._id);
	return res.status;
}

test.beforeAll(async () => {
	test.skip(!(await dbExists(DB)), `${DB} is missing: run \`pnpm seed\` in frontend/ first`);
	accounts.set('system_admin', await createAccount(accountName('sa'), ['system_admin']));
	for (const role of SHELTER_ROLES) {
		accounts.set(
			role,
			await createAccount(accountName(role), [`shelter:${SHELTER}`, `${SHELTER}:${role}`])
		);
	}
	accounts.set(SCOPE_ONLY, await createAccount(accountName('scope'), [`shelter:${SHELTER}`]));
});

test.afterAll(async () => {
	await purgeDocs(DB, written);
	for (const account of accounts.values()) await deleteAccount(account.name);
});

for (const type of PEOPLE_DOC_TYPES) {
	test.describe(`${type} written straight to CouchDB in the user's own shelter`, () => {
		test(`system_admin can write ${type} (control: the probe doc is valid)`, async () => {
			const sa = accounts.get('system_admin')!;
			expect(await write(sa, probeDoc(type, SHELTER, sa.name))).toBe(201);
		});

		for (const role of SHELTER_ROLES) {
			const allowed = WRITERS[type].includes(role);
			test(`${role} ${allowed ? 'can' : 'cannot'} write ${type}`, async () => {
				const gap = KNOWN_GAPS[type];
				test.fail(!allowed && gap !== undefined, `known gap: ${gap}`);
				const account = accounts.get(role)!;
				const status = await write(account, probeDoc(type, SHELTER, account.name));
				if (allowed) expect(status).toBe(201);
				else expect([401, 403], `CouchDB answered ${status}`).toContain(status);
			});
		}

		test(`a shelter scope with no capability cannot write ${type}`, async () => {
			const gap = KNOWN_GAPS[type];
			test.fail(gap !== undefined, `known gap: ${gap}`);
			const account = accounts.get(SCOPE_ONLY)!;
			const status = await write(account, probeDoc(type, SHELTER, account.name));
			expect([401, 403], `CouchDB answered ${status}`).toContain(status);
		});
	});
}
