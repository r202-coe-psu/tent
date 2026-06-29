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

const USERS_ENDPOINT = '/api/v1/users';

export interface UserSummary {
	name: string;
	roles: string[];
	shelter_id?: string | null;
	affiliation_tags?: string[];
}

export function listUsers(): Promise<UserSummary[]> {
	return serviceFetch<UserSummary[]>(USERS_ENDPOINT);
}

export function createUser(input: {
	name: string;
	password: string;
	roles: string[];
	affiliation_tags?: string[];
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
		roles?: string[];
		affiliation_tags?: string[];
	}): Promise<{ ok: true }> {
	return serviceFetch(USERS_ENDPOINT, {
		method: 'PUT',
		body: JSON.stringify({ name, ...input })
	});
}
