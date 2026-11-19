import { serviceFetch } from '$lib/api/service';
import { shelterStore } from '$lib/stores/shelter.svelte';
import type { Shelter, SubStorageItem } from '../domain/schema';
import type { ShelterClosePreview } from '../domain/shelter-close';
import type {
	ShelterCloseActiveJob,
	ShelterCloseJobStarted,
	ShelterCloseJobView
} from '../domain/shelter-close-job';
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
	// A cleared capacity (External shelter) is `undefined`, which JSON.stringify drops, so the
	// server would keep the old value. Send an explicit `null`; the server reads it as "clear".
	// Only a full form save (carries `is_external`) does this, never a partial patch.
	const payload =
		input.is_external === true && input.capacity === undefined
			? { ...input, capacity: null }
			: input;
	return serviceFetch(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`, {
		method: 'PATCH',
		// `_rev` makes the server 409 when the doc changed since the form loaded.
		body: JSON.stringify(rev ? { ...payload, _rev: rev } : payload)
	});
}

/** CR-219 FR-7 preview + CR-243 FR-5 `active_job` while a close job is queued / running. */
export type ShelterClosePreviewWithJob = ShelterClosePreview & {
	active_job?: ShelterCloseActiveJob;
};

export function getShelterClosePreview(code: string): Promise<ShelterClosePreviewWithJob> {
	return serviceFetch<ShelterClosePreviewWithJob>(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/close`,
		{ cache: 'no-store' }
	);
}

/** CR-243 FR-6: start the durable close job — answers `202 { job_id }` right away. */
export function closeShelter(code: string, confirmText: string): Promise<ShelterCloseJobStarted> {
	return serviceFetch<ShelterCloseJobStarted>(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/close`,
		{
			method: 'POST',
			body: JSON.stringify({ confirm_text: confirmText })
		}
	);
}

/** CR-243 FR-8: status / progress of one close job. */
export function getShelterCloseJob(code: string, jobId: string): Promise<ShelterCloseJobView> {
	return serviceFetch<ShelterCloseJobView>(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/close/jobs/${encodeURIComponent(jobId)}`,
		{ cache: 'no-store' }
	);
}

export function closeZone(
	code: string,
	zoneCode: string,
	reason?: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}`,
		{
			method: 'POST',
			body: JSON.stringify({ reason })
		}
	);
}

export function reopenZone(
	code: string,
	zoneCode: string
): Promise<{ ok: true; code: string; zoneCode: string; status: string }> {
	return serviceFetch(
		`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}/zones/${encodeURIComponent(zoneCode)}/reopen`,
		{
			method: 'POST',
			body: JSON.stringify({})
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
