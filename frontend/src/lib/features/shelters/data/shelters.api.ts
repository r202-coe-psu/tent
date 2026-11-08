import { serviceFetch } from '$lib/api/service';
import { shelterStore } from '$lib/stores/shelter.svelte';
import type { Shelter, SubStorageItem } from '../domain/schema';
import type { ShelterClosePreview, ShelterCloseResult } from '../domain/shelter-close';
import type { ShelterSummary } from './shelters.repository';

export type { ShelterSummary };

const SHELTER_ENDPOINT = '/api/back-office/shelter';

export async function listShelters(init: RequestInit = {}): Promise<ShelterSummary[]> {
	const shelters = await serviceFetch<ShelterSummary[]>(SHELTER_ENDPOINT, {
		cache: 'no-store',
		...init
	});
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
	input: Partial<Shelter>,
	rev?: string
): Promise<{ ok: true; code: string; rev: string }> {
	return serviceFetch(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`, {
		method: 'PATCH',
		// `_rev` makes the server 409 when the doc changed since the form loaded.
		body: JSON.stringify(rev ? { ...input, _rev: rev } : input)
	});
}

/** CR-219 FR-7: people the close would change, by stay status (live read). */
export function getShelterClosePreview(code: string): Promise<ShelterClosePreview> {
	return serviceFetch<ShelterClosePreview>(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/close`,
		{ cache: 'no-store' }
	);
}

/** CR-219 FR-8: check out / cancel everyone on a stay, then close the shelter. */
export function closeShelter(code: string, confirmText: string): Promise<ShelterCloseResult> {
	return serviceFetch<ShelterCloseResult>(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/close`, {
		method: 'POST',
		body: JSON.stringify({ confirm_text: confirmText })
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

/** Fields of a storage point a client may send — the server issues `id` and ignores any other key. */
export type StoragePointInput = Omit<SubStorageItem, 'id'>;

/** The shelter's storage points plus the `_rev` a following write must quote (#1186). */
export interface StoragePointsSnapshot {
	rev: string;
	points: SubStorageItem[];
}

const storagePointsEndpoint = (code: string) =>
	`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/storage-points`;

export function getStoragePoints(code: string): Promise<StoragePointsSnapshot> {
	return serviceFetch<StoragePointsSnapshot>(storagePointsEndpoint(code), { cache: 'no-store' });
}

export function addStoragePoint(
	code: string,
	rev: string,
	point: StoragePointInput
): Promise<{ ok: true; rev: string; point: SubStorageItem }> {
	return serviceFetch(storagePointsEndpoint(code), {
		method: 'POST',
		body: JSON.stringify({ _rev: rev, point })
	});
}

export function editStoragePoint(
	code: string,
	pointId: string,
	rev: string,
	point: StoragePointInput
): Promise<{ ok: true; rev: string; point: SubStorageItem }> {
	return serviceFetch(`${storagePointsEndpoint(code)}/${encodeURIComponent(pointId)}`, {
		method: 'PATCH',
		body: JSON.stringify({ _rev: rev, point })
	});
}

export function deleteStoragePoint(
	code: string,
	pointId: string,
	rev: string
): Promise<{ ok: true; rev: string }> {
	return serviceFetch(`${storagePointsEndpoint(code)}/${encodeURIComponent(pointId)}`, {
		method: 'DELETE',
		body: JSON.stringify({ _rev: rev })
	});
}
