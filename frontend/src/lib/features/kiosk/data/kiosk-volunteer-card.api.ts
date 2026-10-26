import { requestError, requestWithTimeout } from './kiosk-check-in.api';

export interface KioskVolunteerCardResult {
	shelter_code: string;
	volunteer: { display_name: string; volunteer_code: string; qr_payload: string };
}

/** Volunteer badge for the phone's owner. 404 `KIOSK_VOLUNTEER_CARD_NOT_FOUND` when no match. */
export function requestKioskVolunteerCard(
	phone: string,
	options: { signal?: AbortSignal } = {}
): Promise<KioskVolunteerCardResult> {
	return requestWithTimeout(
		'/api/v1/kiosk/volunteer-card',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			cache: 'no-store',
			body: JSON.stringify({ phone })
		},
		async (response) => {
			if (!response.ok) throw await requestError(response);
			return (await response.json()) as KioskVolunteerCardResult;
		},
		options.signal
	);
}
