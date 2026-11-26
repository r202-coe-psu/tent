/**
 * Staff of shelter B must not reach shelter A's people data straight through CouchDB,
 * and a role held in B must not count in A. role-permission-matrix.md §1.2 (compound
 * scoped roles) and §3 "scope" cells.
 *
 * UAT-045 · issues #833, #834
 */
import { expect, test } from '@playwright/test';
import {
	asAdmin,
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
import { KNOWN_GAPS } from './matrix.ts';
import { probeDoc } from './probes.ts';

const RUN = Date.now().toString(36);
const { a: A, b: B } = shelterCodes();
const DB_A = shelterDb(A);

let managerB: TestAccount;
let registrarB: TestAccount;
let registrarA: TestAccount;
/** Holds both shelter scopes, but registration_staff only in B. */
let registrarOnlyInB: TestAccount;
let evacueeInA: CouchDoc;
const written: string[] = [];

const DENIED = [401, 403];

async function write(account: TestAccount, doc: CouchDoc): Promise<number> {
	const res = await asSession(
		account.session,
		'PUT',
		`/${DB_A}/${encodeURIComponent(doc._id)}`,
		doc
	);
	if (res.status === 201 || res.status === 202) written.push(doc._id);
	return res.status;
}

test.beforeAll(async () => {
	test.skip(
		!(await dbExists(DB_A)) || !(await dbExists(shelterDb(B))),
		`${DB_A} or ${shelterDb(B)} is missing: run \`pnpm seed\` in frontend/ first`
	);
	const name = (label: string) => `permtest_x_${label}_${RUN}`;
	managerB = await createAccount(name('sm_b'), [`shelter:${B}`, `${B}:shelter_manager`]);
	registrarB = await createAccount(name('reg_b'), [`shelter:${B}`, `${B}:registration_staff`]);
	registrarA = await createAccount(name('reg_a'), [`shelter:${A}`, `${A}:registration_staff`]);
	registrarOnlyInB = await createAccount(name('reg_in_b'), [
		`shelter:${A}`,
		`shelter:${B}`,
		`${B}:registration_staff`
	]);

	evacueeInA = probeDoc('evacuee', A, 'permtest-setup');
	const put = await asAdmin('PUT', `/${DB_A}/${encodeURIComponent(evacueeInA._id)}`, evacueeInA);
	expect(put.status, 'setup: admin writes a probe evacuee into shelter A').toBe(201);
	written.push(evacueeInA._id);
});

test.afterAll(async () => {
	await purgeDocs(DB_A, written);
	for (const account of [managerB, registrarB, registrarA, registrarOnlyInB]) {
		if (account) await deleteAccount(account.name);
	}
});

test.describe(`staff of ${B} reading ${A}`, () => {
	for (const who of ['shelter_manager', 'registration_staff'] as const) {
		const account = () => (who === 'shelter_manager' ? managerB : registrarB);

		test(`${who} of ${B} cannot open an evacuee of ${A}`, async () => {
			const res = await asSession(
				account().session,
				'GET',
				`/${DB_A}/${encodeURIComponent(evacueeInA._id)}`
			);
			expect(DENIED, `CouchDB answered ${res.status}`).toContain(res.status);
		});

		test(`${who} of ${B} cannot list or query ${A}'s database`, async () => {
			const list = await asSession(account().session, 'GET', `/${DB_A}/_all_docs?limit=1`);
			expect(DENIED, `_all_docs answered ${list.status}`).toContain(list.status);
			const find = await asSession(account().session, 'POST', `/${DB_A}/_find`, {
				selector: { type: 'evacuee' },
				limit: 1
			});
			expect(DENIED, `_find answered ${find.status}`).toContain(find.status);
		});
	}
});

test.describe(`writes that cross from ${B} into ${A}`, () => {
	test(`registration_staff of ${B} cannot write an evacuee into ${A}`, async () => {
		const status = await write(registrarB, probeDoc('evacuee', A, registrarB.name));
		expect(DENIED, `CouchDB answered ${status}`).toContain(status);
	});

	test(`registration_staff of ${A} cannot write a doc labelled ${B} into ${A}`, async () => {
		const status = await write(registrarA, probeDoc('evacuee', B, registrarA.name));
		expect(DENIED, `CouchDB answered ${status}`).toContain(status);
	});

	test(`registration_staff held only in ${B} does not count in ${A}`, async () => {
		// Same root cause as people-write: no role check on evacuee, so any member of A writes.
		test.fail(true, `known gap: ${KNOWN_GAPS.evacuee}`);
		const status = await write(registrarOnlyInB, probeDoc('evacuee', A, registrarOnlyInB.name));
		expect(DENIED, `CouchDB answered ${status}`).toContain(status);
	});
});
