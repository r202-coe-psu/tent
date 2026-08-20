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
