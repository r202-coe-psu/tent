/**
 * E2E Tests: User Management — Access Control
 *
 * Strategy (Approach #2 — Real BFF):
 * - Tests run against the SvelteKit dev server (`pnpm preview`) + real CouchDB on port 5984.
 * - `request` fixture calls the BFF `/api/v1/users` endpoint with a genuine AuthSession cookie
 *   obtained by logging in to CouchDB directly (via couch.ts helpers).
 * - Each test creates its own temporary CouchDB users and destroys them in `afterEach`.
 *
 * Coverage:
 * [Auth]    Unauthenticated → 401 UNAUTHENTICATED
 * [Auth]    registration_staff (non-manager) → 403 FORBIDDEN
 * [RBAC-SA] SA may list all users (GET)
 * [RBAC-SA] SA may create user in any shelter with any capability (POST)
 * [RBAC-SA] SA may not grant _admin role → 403
 * [RBAC-SM] SM lists only own-shelter users (GET scoped)
 * [RBAC-SM] SM may create staff user in own shelter (POST)
 * [RBAC-SM] SM may NOT create user in another shelter → 403
 * [RBAC-SM] SM may NOT grant shelter_manager → 403
 * [RBAC-SM] SM may NOT delete a manager → 403
 * [RBAC-SM] SM may NOT delete user from another shelter → 403
 * [RBAC-SM] SM may delete staff in own shelter (DELETE)
 * [RBAC-SM] SM may NOT edit a manager → 403
 * [RBAC-SM] SM may edit staff in own shelter (PUT)
 * [RBAC-SM] SM may NOT change roles to cross-shelter → 403
 * [Validate] POST with short name → 422
 * [Validate] POST with short password → 422
 * [Conflict] POST duplicate username → 409
 */

import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	SM_SH001_ROLES,
	SM_SH002_ROLES,
	STAFF_SH001_ROLES,
	type TestUser
} from '../helpers/couch';

const BASE = 'http://localhost:4173';
const USERS_URL = `${BASE}/api/v1/users`;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build fetch options with the AuthSession cookie for a given session token. */
function withSession(session: string, init: RequestInit = {}): RequestInit {
	return {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Cookie: `AuthSession=${session}`,
			...(init.headers as Record<string, string>)
		}
	};
}

/** POST to /api/v1/users and return parsed body + status. */
async function apiPost(
	session: string,
	body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
	const res = await fetch(
		USERS_URL,
		withSession(session, { method: 'POST', body: JSON.stringify(body) })
	);
	return { status: res.status, body: await res.json().catch(() => null) };
}

/** PUT to /api/v1/users and return parsed body + status. */
async function apiPut(
	session: string,
	body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
	const res = await fetch(
		USERS_URL,
		withSession(session, { method: 'PUT', body: JSON.stringify(body) })
	);
	return { status: res.status, body: await res.json().catch(() => null) };
}

/** DELETE /api/v1/users?name=<name> and return parsed body + status. */
async function apiDelete(
	session: string,
	name: string
): Promise<{ status: number; body: unknown }> {
	const res = await fetch(
		`${USERS_URL}?name=${encodeURIComponent(name)}`,
		withSession(session, { method: 'DELETE' })
	);
	return { status: res.status, body: await res.json().catch(() => null) };
}

/** GET /api/v1/users and return parsed body + status. */
async function apiGet(session: string): Promise<{ status: number; body: unknown }> {
	const res = await fetch(USERS_URL, withSession(session, { method: 'GET' }));
	return { status: res.status, body: await res.json().catch(() => null) };
}

// ─── fixture accounts (persistent across all tests in this file) ──────────────

/** Unique suffix to avoid collisions when tests run in parallel across files. */
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

const ACCOUNTS: TestUser[] = [
	{ name: `e2e_sa_${RUN_ID}`, password: 'Password1!', roles: SA_ROLES, display_name: 'E2E SA' },
	{
		name: `e2e_sm1_${RUN_ID}`,
		password: 'Password1!',
		roles: SM_SH001_ROLES,
		display_name: 'E2E SM SH001'
	},
	{
		name: `e2e_sm2_${RUN_ID}`,
		password: 'Password1!',
		roles: SM_SH002_ROLES,
		display_name: 'E2E SM SH002'
	},
	{
		name: `e2e_staff1_${RUN_ID}`,
		password: 'Password1!',
		roles: STAFF_SH001_ROLES,
		display_name: 'E2E Staff SH001'
	}
];

/** Sessions resolved once and shared across tests. */
const sessions: Record<string, string> = {};
/** Users created mid-test that must be cleaned up after. */
const createdDuringTest: string[] = [];

test.beforeAll(async () => {
	// Create fixture accounts
	for (const acc of ACCOUNTS) {
		await createCouchUser(acc);
	}
	// Obtain sessions
	for (const acc of ACCOUNTS) {
		sessions[acc.name] = await couchLogin(acc.name, acc.password);
	}
});

test.afterAll(async () => {
	// Delete fixture accounts
	for (const acc of ACCOUNTS) {
		await deleteCouchUser(acc.name);
	}
});

test.afterEach(async () => {
	// Delete any users created during the test
	for (const name of createdDuringTest.splice(0)) {
		await deleteCouchUser(name);
	}
});

// Convenience aliases
const saName = () => ACCOUNTS[0].name;
const sm1Name = () => ACCOUNTS[1].name;
const sm2Name = () => ACCOUNTS[2].name;
const staffName = () => ACCOUNTS[3].name;

const saSession = () => sessions[saName()];
const sm1Session = () => sessions[sm1Name()];
const staffSession = () => sessions[staffName()];

// ─── Test Suite ────────────────────────────────────────────────────────────────

test.describe('User Management API — Access Control', () => {
	// ── Authentication ─────────────────────────────────────────────────────────

	test('GET /api/v1/users without auth returns 401 UNAUTHENTICATED', async () => {
		const res = await fetch(USERS_URL, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' }
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('UNAUTHENTICATED');
	});

	test('POST /api/v1/users without auth returns 401 UNAUTHENTICATED', async () => {
		const res = await fetch(USERS_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: 'ghost',
				password: 'password123',
				display_name: 'Ghost',
				roles: ['shelter:SH001', 'registration_staff']
			})
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('UNAUTHENTICATED');
	});

	test('DELETE /api/v1/users without auth returns 401 UNAUTHENTICATED', async () => {
		const { status, body } = await apiDelete('invalid_session_token', 'anyuser');
		expect(status).toBe(401);
		expect((body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
	});

	// ── Registration Staff (non-manager) ───────────────────────────────────────

	test('GET /api/v1/users as registration_staff returns 403 FORBIDDEN', async () => {
		const { status, body } = await apiGet(staffSession());
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('POST /api/v1/users as registration_staff returns 403 FORBIDDEN', async () => {
		const { status, body } = await apiPost(staffSession(), {
			name: 'newuser',
			password: 'password123',
			display_name: 'New User',
			roles: ['shelter:SH001', 'registration_staff']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	// ── System Admin (SA) — GET ────────────────────────────────────────────────

	test('GET /api/v1/users as SA returns 200 with all users array', async () => {
		const { status, body } = await apiGet(saSession());
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
		// SA should see all fixture accounts
		const names = (body as Array<{ name: string }>).map((u) => u.name);
		expect(names).toContain(sm1Name());
		expect(names).toContain(sm2Name());
		expect(names).toContain(staffName());
	});

	// ── System Admin (SA) — POST ───────────────────────────────────────────────

	test('SA can create user with shelter_manager role in any shelter', async () => {
		const newUser = `e2e_new_sm_${RUN_ID}`;
		createdDuringTest.push(newUser);
		const { status, body } = await apiPost(saSession(), {
			name: newUser,
			password: 'SecurePass1!',
			display_name: 'New Manager',
			roles: ['shelter:SH001', 'shelter_manager']
		});
		expect(status).toBe(200);
		expect((body as { ok: boolean }).ok).toBe(true);
	});

	test('SA can create user with registration_staff role in SH002', async () => {
		const newUser = `e2e_new_staff2_${RUN_ID}`;
		createdDuringTest.push(newUser);
		const { status, body } = await apiPost(saSession(), {
			name: newUser,
			password: 'SecurePass1!',
			display_name: 'Staff SH002',
			roles: ['shelter:SH002', 'registration_staff']
		});
		expect(status).toBe(200);
		expect((body as { ok: boolean }).ok).toBe(true);
	});

	test('SA cannot grant _admin role → 403 FORBIDDEN', async () => {
		const { status, body } = await apiPost(saSession(), {
			name: 'would_be_admin',
			password: 'SecurePass1!',
			display_name: 'Bad Actor',
			roles: ['_admin']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('SA cannot assign user to multiple shelters → 422 VALIDATION', async () => {
		const { status, body } = await apiPost(saSession(), {
			name: 'multi_shelter_user',
			password: 'SecurePass1!',
			display_name: 'Multi',
			roles: ['shelter:SH001', 'shelter:SH002', 'registration_staff']
		});
		expect(status).toBe(422);
		expect((body as { error: { code: string } }).error.code).toBe('VALIDATION');
	});

	// ── Shelter Manager (SM) — GET scoped ─────────────────────────────────────

	test('SM of SH001 lists only SH001 users (scope isolation)', async () => {
		const { status, body } = await apiGet(sm1Session());
		expect(status).toBe(200);
		const users = body as Array<{ name: string; roles: string[] }>;
		// Must contain own-shelter users
		const sh001Users = users.filter((u) => u.roles.includes('shelter:SH001'));
		expect(sh001Users.length).toBeGreaterThan(0);
		// Must NOT contain SH002 users
		const sh002Users = users.filter((u) => u.roles.includes('shelter:SH002'));
		expect(sh002Users.length).toBe(0);
	});

	// ── Shelter Manager (SM) — POST ───────────────────────────────────────────

	test('SM of SH001 can create registration_staff in own shelter', async () => {
		const newUser = `e2e_sm_create_${RUN_ID}`;
		createdDuringTest.push(newUser);
		const { status, body } = await apiPost(sm1Session(), {
			name: newUser,
			password: 'SecurePass1!',
			display_name: 'SM Created Staff',
			roles: ['shelter:SH001', 'registration_staff']
		});
		expect(status).toBe(200);
		expect((body as { ok: boolean }).ok).toBe(true);
	});

	test('SM of SH001 cannot create user in SH002 → 403 FORBIDDEN', async () => {
		const { status, body } = await apiPost(sm1Session(), {
			name: 'cross_shelter_user',
			password: 'SecurePass1!',
			display_name: 'Cross Shelter',
			roles: ['shelter:SH002', 'registration_staff']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('SM of SH001 cannot grant shelter_manager role → 403 FORBIDDEN', async () => {
		const { status, body } = await apiPost(sm1Session(), {
			name: 'escalation_attempt',
			password: 'SecurePass1!',
			display_name: 'Escalation',
			roles: ['shelter:SH001', 'shelter_manager']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('SM of SH001 cannot grant system_admin role → 403 FORBIDDEN', async () => {
		const { status, body } = await apiPost(sm1Session(), {
			name: 'sa_escalation_attempt',
			password: 'SecurePass1!',
			display_name: 'SA Escalation',
			roles: ['system_admin']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	// ── Shelter Manager (SM) — DELETE ─────────────────────────────────────────

	test('SM of SH001 can delete a staff user in own shelter', async () => {
		// Create a temporary staff user to delete
		const victim = `e2e_victim_${RUN_ID}`;
		await createCouchUser({ name: victim, password: 'Pass1234!', roles: STAFF_SH001_ROLES });
		// Note: do NOT push to createdDuringTest — we expect it to be deleted by the test
		const { status, body } = await apiDelete(sm1Session(), victim);
		expect(status).toBe(200);
		expect((body as { ok: boolean }).ok).toBe(true);
	});

	test('SM of SH001 cannot delete another shelter_manager → 403 FORBIDDEN', async () => {
		// sm1 tries to delete sm1 itself (own account = manager, not staff)
		// Create a second SH001 manager
		const otherManager = `e2e_other_mgr_${RUN_ID}`;
		createdDuringTest.push(otherManager);
		await createCouchUser({ name: otherManager, password: 'Pass1234!', roles: SM_SH001_ROLES });

		const { status, body } = await apiDelete(sm1Session(), otherManager);
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('SM of SH001 cannot delete a user from SH002 → 403 FORBIDDEN', async () => {
		// sm1 tries to delete sm2 (different shelter)
		const { status, body } = await apiDelete(sm1Session(), sm2Name());
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	// ── Shelter Manager (SM) — PUT ────────────────────────────────────────────

	test('SM of SH001 can update display_name of staff in own shelter', async () => {
		const { status, body } = await apiPut(sm1Session(), {
			name: staffName(),
			display_name: 'Updated Name'
		});
		expect(status).toBe(200);
		expect((body as { ok: boolean }).ok).toBe(true);
	});

	test('SM of SH001 cannot edit a shelter_manager → 403 FORBIDDEN', async () => {
		// sm1 tries to edit sm2 (other SM in SH002)
		const { status, body } = await apiPut(sm1Session(), {
			name: sm2Name(),
			display_name: 'Edited by sm1'
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('SM of SH001 cannot change roles to cross-shelter → 403 FORBIDDEN', async () => {
		const { status, body } = await apiPut(sm1Session(), {
			name: staffName(),
			roles: ['shelter:SH002', 'registration_staff']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	test('SM of SH001 cannot grant shelter_manager via PUT → 403 FORBIDDEN', async () => {
		const { status, body } = await apiPut(sm1Session(), {
			name: staffName(),
			roles: ['shelter:SH001', 'shelter_manager']
		});
		expect(status).toBe(403);
		expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
	});

	// ── Input Validation ───────────────────────────────────────────────────────

	test('POST with username shorter than 3 chars → 422 VALIDATION', async () => {
		const { status, body } = await apiPost(saSession(), {
			name: 'ab',
			password: 'SecurePass1!',
			display_name: 'Short Name',
			roles: ['shelter:SH001', 'registration_staff']
		});
		expect(status).toBe(422);
		expect((body as { error: { code: string } }).error.code).toBe('VALIDATION');
	});

	test('POST with password shorter than 6 chars → 422 VALIDATION', async () => {
		const { status, body } = await apiPost(saSession(), {
			name: 'validname',
			password: '12345',
			display_name: 'Valid Name',
			roles: ['shelter:SH001', 'registration_staff']
		});
		expect(status).toBe(422);
		expect((body as { error: { code: string } }).error.code).toBe('VALIDATION');
	});

	test('POST with missing display_name → 422 VALIDATION', async () => {
		const { status, body } = await apiPost(saSession(), {
			name: 'validname2',
			password: 'SecurePass1!',
			display_name: '',
			roles: ['shelter:SH001', 'registration_staff']
		});
		expect(status).toBe(422);
		expect((body as { error: { code: string } }).error.code).toBe('VALIDATION');
	});

	// ── Conflict ───────────────────────────────────────────────────────────────

	test('POST with duplicate username → 409 CONFLICT', async () => {
		// staffName() already exists — try to create again
		const { status, body } = await apiPost(saSession(), {
			name: staffName(),
			password: 'SecurePass1!',
			display_name: 'Duplicate',
			roles: ['shelter:SH001', 'registration_staff']
		});
		expect(status).toBe(409);
		expect((body as { error: { code: string } }).error.code).toBe('CONFLICT');
	});

	// ── DELETE edge cases ──────────────────────────────────────────────────────

	test('DELETE non-existent user → 422 VALIDATION', async () => {
		const { status, body } = await apiDelete(saSession(), `nonexistent_${RUN_ID}`);
		expect(status).toBe(422);
		expect((body as { error: { code: string } }).error.code).toBe('VALIDATION');
	});

	test('PUT on non-existent user → 422 VALIDATION', async () => {
		const { status, body } = await apiPut(saSession(), {
			name: `nonexistent_${RUN_ID}`,
			display_name: 'Ghost'
		});
		expect(status).toBe(422);
		expect((body as { error: { code: string } }).error.code).toBe('VALIDATION');
	});
});
