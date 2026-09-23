import { dev } from '$app/environment';

export type GateInput =
	{ source: 'smart-card'; citizen_id: string } | { source: 'qr'; token: string };

export interface KioskEvacueeSummary {
	evacuee_id: string;
	first_name: string;
	last_name: string;
	gender: string | null;
	age: number | null;
	status: string;
	is_primary: boolean;
	selectable: boolean;
}

export interface KioskLookupResult {
	shelter_code: string;
	primary_evacuee_id: string;
	members: KioskEvacueeSummary[];
}

export interface KioskCheckInMemberResult {
	evacuee_id: string;
	status: 'checked_in' | 'already_checked_in' | 'not_found' | 'not_eligible' | 'failed';
	stay_status?: string;
	qr_payload?: string;
}

export interface KioskCheckInResult {
	shelter_code: string;
	members: KioskCheckInMemberResult[];
}

async function requestError(response: Response): Promise<Error> {
	const body = (await response.json().catch(() => null)) as {
		error?: { message?: unknown } | unknown;
	} | null;
	const nestedMessage =
		typeof body?.error === 'object' && body.error !== null && 'message' in body.error
			? body.error.message
			: null;
	const message = typeof nestedMessage === 'string' ? nestedMessage : 'ระบบไม่สามารถทำรายการได้';
	return new Error(message);
}

function describeGateForLog(input: GateInput): Record<string, string> {
	return input.source === 'smart-card'
		? { source: input.source, citizen_id_suffix: input.citizen_id.slice(-4) }
		: { source: input.source, token_suffix: input.token.slice(-4) };
}

/** Both card and QR gates resolve through the scanner-authenticated kiosk API. */
export async function lookupPreRegisteredEvacuee(input: GateInput): Promise<KioskLookupResult> {
	if (dev) {
		console.info('[Kiosk lookup] Request', {
			endpoint: '/api/v1/scanner/kiosk/lookup',
			gate: describeGateForLog(input),
			center: 'derived from authenticated scanner device; not sent by the browser'
		});
	}
	const response = await fetch('/api/v1/scanner/kiosk/lookup', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		cache: 'no-store',
		body: JSON.stringify(input)
	});
	if (dev) console.info('[Kiosk lookup] Response', { http_status: response.status });
	if (!response.ok) throw await requestError(response);
	return (await response.json()) as KioskLookupResult;
}

/** The server derives the shelter from device auth and validates household membership. */
export async function checkInSelectedMembers(
	primaryEvacueeId: string,
	evacueeIds: string[]
): Promise<KioskCheckInResult> {
	const response = await fetch('/api/v1/scanner/kiosk/check-in', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		cache: 'no-store',
		body: JSON.stringify({ primary_evacuee_id: primaryEvacueeId, evacuee_ids: evacueeIds })
	});
	if (!response.ok) throw await requestError(response);
	return (await response.json()) as KioskCheckInResult;
}
