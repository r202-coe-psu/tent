/**
 * User-management data layer — talks to the central service plane `/api/v1/users`
 * (same-origin BFF in dev; a reverse proxy routes it to FastAPI in prod). The
 * client never touches CouchDB `/_users` directly, so a shelter_manager (not a
 * CouchDB `_admin`) can manage users — the BFF authorizes by role.
 *
 * Errors follow the contract envelope `{ error: { code, message } }`
 * (api-contract.md §2); we surface `message` so the UI can toast it.
 */

import { serviceFetch } from '$lib/api/service';
import type { DutyWindow } from '../domain/schema';

const USERS_ENDPOINT = '/api/v1/users';

export interface UserSummary {
	name: string;
	roles: string[];
	display_name?: string | null;
	shelter_id?: string | null;
	affiliation_tags?: string[];
	/** `volunteer:{ulid}` this login is linked to, when it is a volunteer account (CR-094 §2.3). */
	volunteer_id?: string | null;
	/** Recorded duty window; `null`/absent means permanent access. Not enforced yet (CR-094 §2.3). */
	duty_window?: DutyWindow | null;
	/** `false` suspends the account. Recorded only — login is not blocked yet (CR-094 §2.3). */
	active?: boolean;
}

export function listUsers(): Promise<UserSummary[]> {
	return serviceFetch<UserSummary[]>(USERS_ENDPOINT);
}

export function createUser(input: {
	name: string;
	password: string;
	display_name: string;
	roles: string[];
	affiliation_tags?: string[];
	volunteer_id?: string | null;
	duty_window?: DutyWindow | null;
	active?: boolean;
}): Promise<{ ok: true }> {
	return serviceFetch(USERS_ENDPOINT, { method: 'POST', body: JSON.stringify(input) });
}

export function deleteUser(name: string): Promise<{ ok: true }> {
	return serviceFetch(`${USERS_ENDPOINT}?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function updateUser(
	name: string,
	input: {
		password?: string;
		display_name?: string;
		roles?: string[];
		affiliation_tags?: string[];
		volunteer_id?: string | null;
		duty_window?: DutyWindow | null;
		active?: boolean;
	}
): Promise<{ ok: true }> {
	return serviceFetch(USERS_ENDPOINT, {
		method: 'PUT',
		body: JSON.stringify({ name, ...input })
	});
}
