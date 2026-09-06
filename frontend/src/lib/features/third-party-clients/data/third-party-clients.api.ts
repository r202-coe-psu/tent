/**
 * Third-party OAuth2 clients data layer — talks to the SA BFF `/api/v1/thirdparty-clients`
 * (session cookie; BFF injects EXTERNAL_API_SECRET toward FastAPI). EXT-001, ADR 0002.
 */
import { serviceFetch } from '$lib/api/service';
import {
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList,
	type CreatedThirdPartyClient,
	type CreateThirdPartyClientInput,
	type ThirdPartyClient
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
