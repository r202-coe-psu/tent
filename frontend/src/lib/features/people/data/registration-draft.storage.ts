/**
 * Where a public pre-registration draft lives (#358): `sessionStorage`, so it never outlives the
 * tab and is not shared with other tabs. Holds personal data (ID number, phone) only until the
 * form is sent or the tab closes; every access is guarded because storage can be blocked
 * (private mode) or full — the form then simply works without a draft.
 */
import {
	fromRegistrationDraft,
	toRegistrationDraft,
	type RegistrationDraft
} from '../domain/registration-draft';

const PREFIX = 'tent.registrationDraft:';

export function loadRegistrationDraft(
	key: string,
	now = Date.now()
): ReturnType<typeof fromRegistrationDraft> {
	try {
		const raw = sessionStorage.getItem(PREFIX + key);
		if (!raw) return null;
		const draft = fromRegistrationDraft(JSON.parse(raw), now);
		if (!draft) sessionStorage.removeItem(PREFIX + key);
		return draft;
	} catch {
		return null;
	}
}

export function saveRegistrationDraft(
	key: string,
	household: RegistrationDraft['household'],
	members: RegistrationDraft['members'],
	now = Date.now()
): void {
	try {
		sessionStorage.setItem(
			PREFIX + key,
			JSON.stringify(toRegistrationDraft(household, members, now))
		);
	} catch {
		// Quota or blocked storage: no draft this time.
	}
}

export function clearRegistrationDraft(key: string): void {
	try {
		sessionStorage.removeItem(PREFIX + key);
	} catch {
		// Nothing stored to clear.
	}
}
