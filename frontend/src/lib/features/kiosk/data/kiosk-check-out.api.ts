import type { KioskCheckoutDestination } from '../domain/self-checkout';
import { requestError, requestWithTimeout, type GateInput } from './kiosk-check-in.api';

export interface KioskCheckOutInput {
	primary_evacuee_id: string;
	evacuee_ids: string[];
	destination_type: KioskCheckoutDestination;
	gate: Extract<GateInput, { source: 'smart-card' | 'thaid' }>;
}

export interface KioskCheckOutMemberResult {
	evacuee_id: string;
	status: 'checked_out' | 'not_eligible' | 'not_found' | 'failed';
	stay_status?: string;
}

export interface KioskCheckOutResult {
	shelter_code: string;
	members: KioskCheckOutMemberResult[];
}

/**
 * #1401: a card / ThaiD holder checks themselves and chosen household members out. A card sends its
 * citizen id, ThaiD only the verified session id (the server resolves who it is). No face check.
 */
export function checkOutKioskMembers(
	input: KioskCheckOutInput,
	options: { signal?: AbortSignal } = {}
): Promise<KioskCheckOutResult> {
	const identity =
		input.gate.source === 'thaid'
			? { source: 'thaid', thaid_session_id: input.gate.session_id }
			: { source: 'smart-card', citizen_id: input.gate.citizen_id };
	return requestWithTimeout(
		'/api/v1/kiosk/check-out',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			cache: 'no-store',
			body: JSON.stringify({
				primary_evacuee_id: input.primary_evacuee_id,
				evacuee_ids: input.evacuee_ids,
				...identity,
				destination_type: input.destination_type
			})
		},
		async (response) => {
			if (!response.ok) throw await requestError(response);
			return (await response.json()) as KioskCheckOutResult;
		},
		options.signal
	);
}
