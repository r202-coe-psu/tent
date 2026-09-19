/**
 * Public booking data access — browser calls the same-origin BFF only.
 *
 * The write path is `/api/public/v1/registrations` → CouchDB via the roleless
 * public writer (CR-070 / T-71). The browser never holds a credential and never
 * talks to CouchDB or FastAPI directly (CR-063).
 *
 * Unassigned Registration (CR-113) uses `/api/public/v1/unassigned-registrations`
 * → BFF Bearer → FastAPI → Mongo only.
 */
import type { components } from '$lib/api/openapi';
import type { UnifiedRegistrationInput } from '$lib/features/people';
import type { PublicBookingInput, PublicBookingLookupInput } from '../domain/booking';
import { publicBookingErrorMessage } from '../domain/booking';
import { unassignedRegistrationErrorMessage } from '../domain/unassigned-registration';

export interface BookingTicketResponse {
	success: true;
	code: string;
	shelter_code: string;
	shelter_name: string;
	first_name: string;
	status: string;
	booked_at: string;
}

export type PublicUnifiedBookingPayload = UnifiedRegistrationInput & {
	shelter_code: string;
	captchaToken?: string;
	disclaimerAcknowledged?: boolean;
};

/** Turn the BFF's `{ success:false, error }` envelope into a Thai-language Error. */
async function bookingError(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
	return new Error(publicBookingErrorMessage(body?.error));
}

export async function createBooking(
	input: PublicBookingInput | PublicUnifiedBookingPayload
): Promise<BookingTicketResponse> {
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

export type UnassignedRegistrationResponse =
	components['schemas']['UnassignedRegistrationCreateResponse'];

export type PublicUnassignedRegistrationPayload = UnifiedRegistrationInput & {
	captchaToken?: string;
	disclaimerAcknowledged?: boolean;
};

async function unassignedRegistrationError(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
	return new Error(unassignedRegistrationErrorMessage(body?.error as string | undefined));
}

/**
 * Public Pre-registration without a shelter (CR-113 / #255).
 * Browser → same-origin BFF only; body is UnifiedRegistrationInput (+ captcha/meta).
 */
export async function createUnassignedRegistration(
	input: PublicUnassignedRegistrationPayload
): Promise<UnassignedRegistrationResponse> {
	const res = await fetch('/api/public/v1/unassigned-registrations', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) throw await unassignedRegistrationError(res);
	return (await res.json()) as UnassignedRegistrationResponse;
}

export type ResidenceMatchChip = {
	match_token: string;
	landmark?: string | null;
	housing_type?: string | null;
	shelter_code?: string | null;
	shelter_name?: string | null;
	is_in_shelter?: boolean;
	primary_contact_masked?: string | null;
	matched_member_masked?: string | null;
	member_count?: number;
	pets?: Array<{ species: string; name?: string; count?: number; details?: string }>;
	address?: {
		housing_type?: string;
		residence_landmark?: string | null;
		address_no?: string;
		village_no?: string;
		subdistrict?: string;
		district?: string;
		province?: string;
		postal_code?: string;
	} | null;
};

export type ResidenceMatchRequest = {
	shelter_code?: string;
	unassigned?: boolean;
	housing_type?: string | null;
	residence_landmark?: string | null;
	address_no?: string | null;
	village_no?: string | null;
	subdistrict?: string | null;
	district?: string | null;
	province?: string | null;
	postal_code?: string | null;
	phone?: string | null;
};

/** Debounced Residence suggest for public create — tokens + non-PII chips only. */
export async function matchResidence(
	input: ResidenceMatchRequest
): Promise<{ matches: ResidenceMatchChip[] }> {
	const res = await fetch('/api/public/v1/households/residence-match', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		return { matches: [] };
	}
	const body = (await res.json()) as { matches?: ResidenceMatchChip[] };
	return { matches: body.matches ?? [] };
}

export interface UnassignedPhotoUploadResponse {
	success: true;
	photo_id: string;
	content_type: string;
	filename: string;
	width?: number | null;
	height?: number | null;
	original_size?: number | null;
	compressed_size?: number | null;
	thumbnail_size?: number | null;
}

/**
 * Upload a compressed face or pet photo for Unassigned Registration (GridFS via BFF).
 */
export async function uploadUnassignedPhoto(
	form: FormData
): Promise<UnassignedPhotoUploadResponse> {
	const res = await fetch('/api/public/v1/unassigned-registrations/photos', {
		method: 'POST',
		body: form
	});
	if (!res.ok) throw await unassignedRegistrationError(res);
	return (await res.json()) as UnassignedPhotoUploadResponse;
}

export type ShelterBookingPhotoUploadResponse = UnassignedPhotoUploadResponse;

/**
 * Upload a compressed face/pet photo for public **shelter** booking.
 * BFF → Couch `image:{ulid}` in the chosen shelter DB (not GridFS).
 */
export async function uploadShelterBookingPhoto(
	shelterCode: string,
	form: FormData
): Promise<ShelterBookingPhotoUploadResponse> {
	form.set('shelter_code', shelterCode.trim());
	const res = await fetch('/api/public/v1/registrations/photos', {
		method: 'POST',
		body: form
	});
	if (!res.ok) throw await bookingError(res);
	return (await res.json()) as ShelterBookingPhotoUploadResponse;
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
 * Thailand address cascade for the booking form's domicile address (CR-107),
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

export interface ShelterPolicyResponse {
	code?: string;
	name?: string;
	feature_flags: {
		allow_pets: boolean;
		allow_assets: boolean;
		allow_vehicles: boolean;
	};
	admission_policy?: {
		pet_policy?: {
			policy: 'no_pets' | 'conditional';
			categories?: {
				category: 'dog' | 'cat' | 'bird' | 'exotic' | 'other';
				conditions?: ('leashed' | 'caged' | 'vaccinated' | 'owner_responsibility')[];
				other?: string;
			}[];
		};
	} | null;
	luggage_policy?: {
		limitation?: 'no_limit' | 'limited' | 'prohibited';
		rules?: ('valuables_declaration' | 'prohibited_items_check' | 'labeling_required')[];
		rules_other?: string;
	} | null;
	parking_policy?: {
		availability?: 'available' | 'limited' | 'none';
		rules?: ('registered_vehicles_only' | 'designated_areas_only' | 'no_overnight_stay')[];
		rules_other?: string;
	} | null;
}

export async function fetchShelterPolicy(
	shelterCode: string
): Promise<ShelterPolicyResponse | null> {
	if (!shelterCode.trim()) return null;
	const res = await fetch(
		`/api/public/v1/config/shelter-policy?shelter=${encodeURIComponent(shelterCode)}`
	);
	if (!res.ok) return null;
	return (await res.json().catch(() => null)) as ShelterPolicyResponse | null;
}

export interface TicketStatusResult {
	success: boolean;
	verified: boolean;
	status?: string;
	error?: string;
}

/** Check if an issued ticket has been verified / checked in at the shelter */
export async function checkTicketStatus(code: string): Promise<TicketStatusResult> {
	if (!code.trim()) return { success: false, verified: false, error: 'NO_CODE' };
	try {
		const res = await fetch('/api/public/v1/registrations/status', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: code.trim() })
		});
		const body = (await res.json().catch(() => ({}))) as TicketStatusResult;
		return {
			success: res.ok && body.success === true,
			verified: body.verified === true,
			status: body.status,
			error: body.error
		};
	} catch (e) {
		return {
			success: false,
			verified: false,
			error: e instanceof Error ? e.message : 'NETWORK_ERROR'
		};
	}
}
