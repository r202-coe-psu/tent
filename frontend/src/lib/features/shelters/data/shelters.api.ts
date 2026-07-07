import { serviceFetch } from '$lib/api/service';
import { shelterStore } from '$lib/stores/shelter.svelte';
import type { Shelter } from '../domain/schema';
import type { ShelterSummary } from './shelters.repository';

export type { ShelterSummary };

const SHELTER_ENDPOINT = '/api/back-office/shelter';

export async function listShelters(): Promise<ShelterSummary[]> {
	const shelters = await serviceFetch<ShelterSummary[]>(SHELTER_ENDPOINT);
	if (shelters.length > 0 && !shelterStore.listDefaultCode) {
		shelterStore.listDefaultCode = shelters[0].code;
	}
	return shelters;
}

export function getShelter(code: string): Promise<ShelterSummary> {
	return serviceFetch<ShelterSummary>(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`);
}

export function createShelter(input: Shelter): Promise<{ ok: true; code: string }> {
	return serviceFetch(SHELTER_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function updateShelter(
	code: string,
	input: Partial<Shelter>
): Promise<{ ok: true; code: string }> {
	return serviceFetch(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`, {
		method: 'PATCH',
		body: JSON.stringify(input)
	});
}

export function closeZone(
	code: string,
	zoneCode: string,
	reason?: string,
	closedBy?: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}`,
		{
			method: 'POST',
			body: JSON.stringify({ reason, closed_by: closedBy })
		}
	);
}

export function reopenZone(
	code: string,
	zoneCode: string,
	reopenedBy?: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}/reopen`,
		{
			method: 'POST',
			body: JSON.stringify({ reopened_by: reopenedBy })
		}
	);
}
