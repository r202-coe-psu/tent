/**
 * Public booking data access — browser calls the same-origin BFF only.
 *
 * The write path is `/api/public/v1/registrations` → CouchDB via the roleless
 * public writer (CR-070 / T-71). The browser never holds a credential and never
 * talks to CouchDB or FastAPI directly (CR-063).
 */
import type { PublicBookingInput, PublicBookingLookupInput } from '../domain/booking';
import { publicBookingErrorMessage } from '../domain/booking';

export interface BookingTicketResponse {
	success: true;
	code: string;
	shelter_code: string;
	shelter_name: string;
	first_name: string;
	status: string;
	booked_at: string;
}

/** Turn the BFF's `{ success:false, error }` envelope into a Thai-language Error. */
async function bookingError(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
	return new Error(publicBookingErrorMessage(body?.error));
}

export async function createBooking(input: PublicBookingInput): Promise<BookingTicketResponse> {
	const res = await fetch('/api/public/v1/registrations', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) throw await bookingError(res);
	return (await res.json()) as BookingTicketResponse;
}

export async function lookupBooking(
	input: PublicBookingLookupInput
): Promise<BookingTicketResponse> {
	const res = await fetch('/api/public/v1/registrations/lookup', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) throw await bookingError(res);
	return (await res.json()) as BookingTicketResponse;
}

export interface PetTypeOption {
	code: string;
	label: string;
	is_default: boolean;
}

/**
 * Pet species offered for one shelter (`/api/public/v1/config/pet-types`) —
 * global + shelter-local `pet_types` master data merged server-side. Degrades
 * to an empty list on any failure, same as the vulnerable-groups reference
 * data: a slow/broken lookup must not block the rest of the booking form.
 */
export async function fetchPetTypes(shelterCode: string): Promise<PetTypeOption[]> {
	const res = await fetch(
		`/api/public/v1/config/pet-types?shelter=${encodeURIComponent(shelterCode)}`
	);
	if (!res.ok) return [];
	const body = (await res.json().catch(() => null)) as { petTypes?: PetTypeOption[] } | null;
	return body?.petTypes ?? [];
}

export interface PublicSubdistrict {
	subdistrict: string;
	zipcode: number;
}

const LOCATIONS = '/api/public/v1/config/locations';

/**
 * Thailand address cascade for the booking form's domicile address (CR-105),
 * served by the public BFF (`/api/public/v1/config/locations`) — never
 * `serviceFetch`, which is the staff service plane. Each level degrades to an
 * empty list: a failed lookup narrows the choices, it must not break the form.
 */
export async function fetchProvinces(): Promise<string[]> {
	const res = await fetch(LOCATIONS);
	if (!res.ok) return [];
	const body = (await res.json().catch(() => null)) as { provinces?: string[] } | null;
	return body?.provinces ?? [];
}

export async function fetchDistricts(province: string): Promise<string[]> {
	const res = await fetch(`${LOCATIONS}?province=${encodeURIComponent(province)}`);
	if (!res.ok) return [];
	const body = (await res.json().catch(() => null)) as { districts?: string[] } | null;
	return body?.districts ?? [];
}

export async function fetchSubdistricts(
	province: string,
	district: string
): Promise<PublicSubdistrict[]> {
	const res = await fetch(
		`${LOCATIONS}?province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}`
	);
	if (!res.ok) return [];
	const body = (await res.json().catch(() => null)) as {
		subdistricts?: PublicSubdistrict[];
	} | null;
	return body?.subdistricts ?? [];
}
