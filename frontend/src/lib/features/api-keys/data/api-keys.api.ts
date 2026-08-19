/**
 * API keys data layer — talks to the SA BFF `/api/v1/api-keys`
 * (session cookie; BFF injects EXTERNAL_API_SECRET toward FastAPI).
 */
import { serviceFetch } from '$lib/api/service';
import {
	normalizeApiKeyList,
	normalizeRevokedApiKey,
	type ApiKey,
	type CreatedApiKey
} from '../domain/api-key';

const BASE = '/api/v1/api-keys';

export function listApiKeys(): Promise<ApiKey[]> {
	return serviceFetch<unknown>(BASE).then(normalizeApiKeyList);
}

export function createApiKey(input: {
	name: string;
	owner: string;
	expires_at: string;
}): Promise<CreatedApiKey> {
	return serviceFetch<CreatedApiKey>(BASE, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function revokeApiKey(id: string): Promise<ApiKey> {
	return serviceFetch<unknown>(`${BASE}/${encodeURIComponent(id)}/revoke`, {
		method: 'POST'
	}).then(normalizeRevokedApiKey);
}
