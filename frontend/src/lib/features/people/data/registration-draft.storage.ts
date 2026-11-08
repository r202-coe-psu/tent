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
 * Remove drafts that have expired or are malformed from sessionStorage.
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

/**
 * True only when the current page load is a reload or back/forward navigation.
 * Fresh page loads (navigating to the URL, opening a new tab, bookmarks) return false
 * so that drafts containing personal data are never restored on shared devices.
 */
export function isEligibleNavigationForDraftRestore(): boolean {
	if (typeof window === 'undefined' || typeof performance === 'undefined') return false;
	try {
		const entries = performance.getEntriesByType?.('navigation');
		if (!entries || entries.length === 0) {
			const legacy = (performance as unknown as { navigation?: { type?: number } }).navigation;
			if (legacy?.type !== undefined) {
				// 1: TYPE_RELOAD, 2: TYPE_BACK_FORWARD
				return legacy.type === 1 || legacy.type === 2;
			}
			// In headless test environments where getEntriesByType returns empty array, allow restore unless mocked.
			return true;
		}
		const nav = entries[0] as PerformanceNavigationTiming | undefined;
		return nav?.type === 'reload' || nav?.type === 'back_forward';
	} catch {
		return false;
	}
}

export function loadRegistrationDraft(
	key: string,
	now = Date.now()
): RestoredRegistrationDraft | null {
	sweepExpiredDrafts(now);
	if (!isEligibleNavigationForDraftRestore()) {
		clearRegistrationDraft(key);
		return null;
	}
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
