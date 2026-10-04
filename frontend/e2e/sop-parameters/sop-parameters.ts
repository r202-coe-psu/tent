import { expect, type Page } from '@playwright/test';
import { ulid } from '../../src/lib/db/ulid';
import {
	allDocuments,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	deleteDocument,
	getDocument,
	putDocument,
	seedSecurityQuestion,
	SA_ROLES,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES,
	type CouchDocument,
	type TestUser
} from '../helpers/couch';
import { clearSession, injectSession } from '../helpers/login';

export const SHELTER_CODE = 'SH001';
export const SHELTER_DB = 'shelter_sh001';
export const CATALOG_DB = 'catalog';
export const POINTER_ID = 'sop_profile_active:global';
export const BACK_OFFICE_SOP_PATH = '/back-office/sop-parameters';
export const SYSTEM_SOP_PATH = '/system-management/sop-parameters';
const SHELTER_STORAGE_KEY = 'tent.activeShelterCode';
const CLEANUP_PASSES = 3;

export type Ratios = Record<string, string>;

export interface ScenarioUser extends TestUser {
	session: string;
}

export interface SopScenario {
	namespace: string;
	suffix: string;
	sa: ScenarioUser;
	manager: ScenarioUser;
	staff: ScenarioUser;
	pointerSnapshot: CouchDocument | null;
	ownedDocumentIds: Set<string>;
}

async function createScenarioUser(
	namespace: string,
	role: string,
	roles: string[]
): Promise<ScenarioUser> {
	const user: TestUser = {
		name: `${namespace}_${role}`,
		password: 'Password1!',
		roles,
		display_name: `SOP E2E ${role}`
	};
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return { ...user, session: await couchLogin(user.name, user.password) };
}

export async function createSopScenario(label: string): Promise<SopScenario> {
	const suffix = ulid().toLowerCase();
	const namespace = `e2e_sop_${label}_${suffix}`;
	return {
		namespace,
		suffix,
		sa: await createScenarioUser(namespace, 'sa', SA_ROLES),
		manager: await createScenarioUser(namespace, 'sm', SM_SH001_ROLES),
		staff: await createScenarioUser(namespace, 'staff', STAFF_SH001_ROLES),
		pointerSnapshot: await getDocument(CATALOG_DB, POINTER_ID),
		ownedDocumentIds: new Set()
	};
}

function scenarioUserNames(scenario: SopScenario): Set<string> {
	return new Set([scenario.sa.name, scenario.manager.name, scenario.staff.name]);
}

function isOwnedDocument(scenario: SopScenario, doc: CouchDocument): boolean {
	return (
		scenario.ownedDocumentIds.has(doc._id) ||
		scenarioUserNames(scenario).has(doc.created_by as string)
	);
}

async function restorePointer(scenario: SopScenario): Promise<void> {
	const current = await getDocument(CATALOG_DB, POINTER_ID);
	if (!current) return;
	const target = await getDocument(CATALOG_DB, current.active_profile_id as string);
	const pointsAtOwned =
		scenarioUserNames(scenario).has(current.updated_by as string) ||
		(target !== null && isOwnedDocument(scenario, target));
	if (!pointsAtOwned) return;

	const path = `/${CATALOG_DB}/${encodeURIComponent(POINTER_ID)}`;
	let rev = current._rev;
	let status = 0;
	for (let pass = 1; pass <= CLEANUP_PASSES; pass += 1) {
		const res = scenario.pointerSnapshot
			? await couchReq('PUT', path, { ...scenario.pointerSnapshot, _rev: rev })
			: await couchReq('DELETE', `${path}?rev=${encodeURIComponent(rev!)}`);
		status = res.status;
		if (status < 400 || status === 404) return;
		if (status !== 409) break;
		const latest = await getDocument(CATALOG_DB, POINTER_ID);
		if (!latest) return;
		rev = latest._rev;
	}
	throw new Error(`Could not restore the active SOP master pointer (HTTP ${status})`);
}

export async function cleanupSopScenario(scenario: SopScenario): Promise<void> {
	const errors: Error[] = [];
	const collect = (error: unknown) =>
		errors.push(error instanceof Error ? error : new Error(String(error)));

	try {
		await restorePointer(scenario);
	} catch (error) {
		collect(error);
	}

	for (const db of [CATALOG_DB, SHELTER_DB]) {
		for (let pass = 1; pass <= CLEANUP_PASSES; pass += 1) {
			let documents: CouchDocument[];
			try {
				documents = await allDocuments(db);
			} catch (error) {
				collect(error);
				break;
			}
			const owned = documents.filter(
				(doc) => doc._id !== POINTER_ID && isOwnedDocument(scenario, doc)
			);
			if (owned.length === 0) break;
			const results = await Promise.allSettled(owned.map((doc) => deleteDocument(db, doc)));
			if (pass < CLEANUP_PASSES) continue;
			for (const result of results) if (result.status === 'rejected') collect(result.reason);
		}
	}

	for (const user of [scenario.sa, scenario.manager, scenario.staff]) {
		try {
			await deleteCouchUser(user.name);
		} catch (error) {
			collect(error);
		}
	}

	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean E2E scenario ${scenario.namespace}`);
	}
}

export async function withSopScenario<T>(
	label: string,
	fn: (scenario: SopScenario) => Promise<T>
): Promise<T> {
	const scenario = await createSopScenario(label);
	let result!: T;
	let scenarioError: unknown;
	let cleanupError: unknown;

	try {
		result = await fn(scenario);
	} catch (error) {
		scenarioError = error;
	}

	try {
		await cleanupSopScenario(scenario);
	} catch (error) {
		cleanupError = error;
	}

	if (scenarioError && cleanupError) {
		throw new AggregateError([scenarioError, cleanupError], 'Scenario and cleanup both failed');
	}
	if (scenarioError) throw scenarioError;
	if (cleanupError) throw cleanupError;
	return result;
}

export async function activeMasterRatios(): Promise<Ratios> {
	const pointer = await getDocument(CATALOG_DB, POINTER_ID);
	if (!pointer) throw new Error('No active SOP master — seed the catalog before running E2E');
	const profile = await getDocument(CATALOG_DB, pointer.active_profile_id as string);
	if (!profile) throw new Error(`Active SOP master ${pointer.active_profile_id} is missing`);
	return profile.ratios as Ratios;
}

export async function seedActiveE2eMaster(
	scenario: SopScenario,
	ratios: Ratios
): Promise<CouchDocument> {
	const slug = `e2e-sop-${scenario.suffix}`;
	const now = new Date().toISOString();
	const profile: CouchDocument = {
		_id: `sop_profile:${slug}:1`,
		type: 'sop_profile',
		schema_v: 3,
		created_at: now,
		updated_at: now,
		created_by: scenario.sa.name,
		name: `E2E SOP ${scenario.suffix}`,
		slug,
		ratios,
		version: 1,
		active: true
	};
	await putDocument(CATALOG_DB, profile);
	scenario.ownedDocumentIds.add(profile._id);

	const current = await getDocument(CATALOG_DB, POINTER_ID);
	await putDocument(CATALOG_DB, {
		_id: POINTER_ID,
		...(current?._rev ? { _rev: current._rev } : {}),
		type: 'sop_profile_active',
		schema_v: 1,
		active_profile_id: profile._id,
		active_slug: slug,
		active_version: 1,
		updated_at: now,
		updated_by: scenario.sa.name
	});
	return profile;
}
export async function foreignActiveOverrides(scenario: SopScenario): Promise<CouchDocument[]> {
	return (await allDocuments(SHELTER_DB)).filter(
		(doc) => doc.type === 'sop_override' && doc.active === true && !isOwnedDocument(scenario, doc)
	);
}

export async function switchAccount(
	page: Page,
	user: ScenarioUser,
	path = BACK_OFFICE_SOP_PATH
): Promise<void> {
	await clearSession(page);
	await injectSession(page, user, user.session);
	await page.evaluate(([key, code]) => localStorage.setItem(key, code), [
		SHELTER_STORAGE_KEY,
		SHELTER_CODE
	] as const);
	await page.goto(path);
	await expect(page.getByRole('heading', { name: 'ตัวแปรมาตรฐาน Sphere' })).toBeVisible({
		timeout: 15_000
	});
}

// ─── CouchDB access ──────────────────────────────────────────────────────────

export async function findDocuments(
	db: string,
	predicate: (doc: CouchDocument) => boolean
): Promise<CouchDocument[]> {
	return (await allDocuments(db)).filter(predicate);
}
