import { serviceFetch } from '$lib/api/service';
import type { Shelter } from '../domain/schema';

const SHELTER_ENDPOINT = '/api/back-office/shelter';

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
