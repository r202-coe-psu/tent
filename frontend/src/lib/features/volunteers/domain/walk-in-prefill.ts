import { normalizeThaiPhone } from '$lib/db/model';
import { isVolunteerMobile } from './phone';
import type { WalkInVolunteerFormValues } from './volunteer.schema';

/**
 * The slice of a shelter evacuee the walk-in dialog needs to pre-fill the form (#1062).
 * Structural on purpose: the volunteers domain does not import the people feature, and a
 * people `Evacuee` is assignable to this.
 */
export interface WalkInPrefillSource {
	first_name: string;
	last_name: string;
	nickname?: string | null;
	phone?: string | null;
	person_id?: { cardType?: string | null; number?: string | null } | null;
}

/** The form fields a pick may write. `email` is never touched (evacuees carry none). */
export type WalkInPrefill = Partial<
	Pick<WalkInVolunteerFormValues, 'first_name' | 'last_name' | 'nickname' | 'phone' | 'national_id'>
>;

/**
 * Map an evacuee onto walk-in form values (UI-only fill — nothing is linked or persisted).
 *
 * Only fields the evacuee really has are returned, so the caller can keep whatever the
 * operator already typed for the rest:
 * - `phone` is normalised (`+66…`/dashes → `0XXXXXXXXX`) and dropped when it is not a valid
 *   10-digit mobile, so a landline never produces a validation error the operator didn't cause;
 * - `national_id` is returned only for a 13-digit `national_id` card — passports, pink cards,
 *   `ANON-…` handles etc. are not Thai national IDs and the volunteer field rejects them.
 */
export function evacueeToWalkInPrefill(evacuee: WalkInPrefillSource): WalkInPrefill {
	const fill: WalkInPrefill = {};

	const firstName = evacuee.first_name?.trim();
	if (firstName) fill.first_name = firstName;
	const lastName = evacuee.last_name?.trim();
	if (lastName) fill.last_name = lastName;
	const nickname = evacuee.nickname?.trim();
	if (nickname) fill.nickname = nickname;

	const rawPhone = evacuee.phone?.trim();
	if (rawPhone && isVolunteerMobile(rawPhone)) fill.phone = normalizeThaiPhone(rawPhone);

	const card = evacuee.person_id;
	const cardNumber = card?.number?.trim();
	if (card?.cardType === 'national_id' && cardNumber && /^\d{13}$/.test(cardNumber)) {
		fill.national_id = cardNumber;
	}

	return fill;
}
