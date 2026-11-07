/**
 * Where a public pre-registration draft lives (#358): `sessionStorage`, so it never outlives the
 * tab and is not shared with other tabs. Holds personal data (ID number, phone) only until the
 * form is sent or the tab closes; every access is guarded because storage can be blocked
 * (private mode) or full — the form then simply works without a draft.
 */
import {
	fromRegistrationDraft,
	toRegistrationDraft,
	REGISTRATION_DRAFT_MAX_AGE_MS,
	type RegistrationDraft,
	type RestoredRegistrationDraft
} from '../domain/registration-draft';

const PREFIX = 'tent.registrationDraft:';

/**
 * Remove drafts that have expired or are malformed from sessionStorage (#358 review W1).
 */
export function sweepExpiredDrafts(now = Date.now()): void {
	try {
		for (let i = sessionStorage.length - 1; i >= 0; i--) {
			const k = sessionStorage.key(i);
			if (!k || !k.startsWith(PREFIX)) continue;
			const raw = sessionStorage.getItem(k);
			if (!raw) {
				sessionStorage.removeItem(k);
				continue;
			}
			try {
				const parsed = JSON.parse(raw);
				if (
					!parsed ||
					typeof parsed.saved_at !== 'number' ||
					now - parsed.saved_at > REGISTRATION_DRAFT_MAX_AGE_MS ||
					parsed.saved_at > now
				) {
					sessionStorage.removeItem(k);
				}
			} catch {
				sessionStorage.removeItem(k);
			}
		}
	} catch {
		// Storage access blocked or unavailable
	}
}

export function loadRegistrationDraft(
	key: string,
	now = Date.now()
): RestoredRegistrationDraft | null {
	sweepExpiredDrafts(now);
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
	sweepExpiredDrafts(now);
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
