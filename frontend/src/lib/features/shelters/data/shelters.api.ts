import { serviceFetch } from '$lib/api/service';
import type {
	CreateShelterInput,
	UpdateShelterInput,
	Zone,
	Item,
	Rule,
	Sop
} from '../domain/schema';

/**
 * Shelter provisioning data layer — talks to the dev admin route
 * `/api/back-office/shelter` (creates db + _security + validate_doc_update + registry
 * master doc, schema.md §3.1). Admin-only; in prod this is a provisioning
 * service, not a client path.
 */
const SHELTER_ENDPOINT = '/api/back-office/shelter';

export type { Zone, Item, Rule, Sop };

export interface ShelterSummary {
	code: string;
	name: string;
	db: string;
	status: string;
	capacity: number;
	zones: Zone[];
	items: Item[];
	rules: Rule[];
	sops: Sop[];
}

export function listShelters(): Promise<ShelterSummary[]> {
	return serviceFetch<ShelterSummary[]>(SHELTER_ENDPOINT);
}

export function getShelter(code: string): Promise<ShelterSummary> {
	return serviceFetch<ShelterSummary>(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`);
}

export function createShelter(input: CreateShelterInput): Promise<{ ok: true; code: string }> {
	return serviceFetch(SHELTER_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function updateShelter(
	code: string,
	input: UpdateShelterInput
): Promise<{ ok: true; code: string }> {
	return serviceFetch(`${SHELTER_ENDPOINT}/${encodeURIComponent(code)}`, {
		method: 'PATCH',
		body: JSON.stringify(input)
	});
}
