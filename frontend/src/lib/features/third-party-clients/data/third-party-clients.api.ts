/**
 * Third-party OAuth2 clients data layer — talks to the SA BFF `/api/v1/thirdparty-clients`
 * (session cookie; BFF injects EXTERNAL_API_SECRET toward FastAPI). EXT-001, ADR 0002.
 */
import { serviceFetch } from '$lib/api/service';
import {
	normalizeDeletedThirdPartyClient,
	normalizeRevealedSecret,
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList,
	type CreatedThirdPartyClient,
	type CreateThirdPartyClientInput,
	type ThirdPartyClient,
	type UpdateThirdPartyClientScopesInput
} from '../domain/third-party-client';

const BASE = '/api/v1/thirdparty-clients';

export function listThirdPartyClients(): Promise<ThirdPartyClient[]> {
	return serviceFetch<unknown>(BASE).then(normalizeThirdPartyClientList);
}

export function createThirdPartyClient(
	input: CreateThirdPartyClientInput
): Promise<CreatedThirdPartyClient> {
	return serviceFetch<CreatedThirdPartyClient>(BASE, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function revokeThirdPartyClient(id: string): Promise<ThirdPartyClient> {
	return serviceFetch<unknown>(`${BASE}/${encodeURIComponent(id)}/revoke`, {
		method: 'POST'
	}).then(normalizeRevokedThirdPartyClient);
}

/** Edit scopes — refused (409) once the client has been revoked. */
export function updateThirdPartyClientScopes(
	id: string,
	input: UpdateThirdPartyClientScopesInput
): Promise<ThirdPartyClient> {
	return serviceFetch<ThirdPartyClient>(`${BASE}/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		body: JSON.stringify(input)
	});
}

/** Soft-delete — refused (409) unless the client is already revoked. */
export function deleteThirdPartyClient(id: string): Promise<ThirdPartyClient> {
	return serviceFetch<unknown>(`${BASE}/${encodeURIComponent(id)}`, {
		method: 'DELETE'
	}).then(normalizeDeletedThirdPartyClient);
}

/** Re-verify the caller's own password, then return the client's plaintext secret again. */
export function revealThirdPartyClientSecret(id: string, password: string): Promise<string> {
	return serviceFetch<unknown>(`${BASE}/${encodeURIComponent(id)}/secret`, {
		method: 'POST',
		body: JSON.stringify({ password })
	}).then(normalizeRevealedSecret);
}

/**
 * Issue a new secret for this client_id — the old secret stops working immediately.
 * Refused (409) once the client has been revoked (same rule as editing scopes).
 */
export function regenerateThirdPartyClientSecret(id: string): Promise<CreatedThirdPartyClient> {
	return serviceFetch<CreatedThirdPartyClient>(
		`${BASE}/${encodeURIComponent(id)}/regenerate-secret`,
		{ method: 'POST' }
	);
}
