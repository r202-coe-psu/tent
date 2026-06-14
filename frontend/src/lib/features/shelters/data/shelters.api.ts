import { serviceFetch } from '$lib/api/service';
import type { CreateShelterInput } from '../domain/schema';

/**
 * Shelter provisioning data layer — talks to the dev admin route
 * `/api/admin/shelter` (creates db + _security + validate_doc_update + registry
 * master doc, schema.md §3.1). Admin-only; in prod this is a provisioning
 * service, not a client path.
 */
const SHELTER_ENDPOINT = '/api/admin/shelter';

export interface Zone {
	code: string;
	name: string;
	capacity: number;
}

export interface ShelterSummary {
	code: string;
	name: string;
	db: string;
	status: string;
	zones: Zone[];
}

export function listShelters(): Promise<ShelterSummary[]> {
	return serviceFetch<ShelterSummary[]>(SHELTER_ENDPOINT);
}

export function createShelter(input: CreateShelterInput): Promise<{ ok: true; code: string }> {
	return serviceFetch(SHELTER_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify({ name: input.name })
	});
}
