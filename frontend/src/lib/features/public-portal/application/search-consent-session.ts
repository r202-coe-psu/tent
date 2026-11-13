/**
 * CR-231 FR-2 — the confirmed searcher/purpose/consent lives in `sessionStorage` (closing the tab
 * asks again) and is shared by `/search` and the home-page modal. Storage can be absent (SSR off
 * but prerender, tests) or blocked, so every access is guarded; unreadable = not confirmed.
 */
import { browser } from '$app/environment';
import { parseSearchConsent, type SearchConsent } from '../domain/search-consent';

export const SEARCH_CONSENT_STORAGE_KEY = 'public-search-consent:v1';

export function getConfirmedSearchConsent(): SearchConsent | null {
	if (!browser) return null;
	try {
		const raw = sessionStorage.getItem(SEARCH_CONSENT_STORAGE_KEY);
		if (!raw) return null;
		const parsed = parseSearchConsent(JSON.parse(raw));
		return parsed.ok ? parsed.consent : null;
	} catch {
		return null;
	}
}

/** Returns false when the value could not be persisted (the caller still searches this once). */
export function storeConfirmedSearchConsent(consent: SearchConsent): boolean {
	if (!browser) return false;
	try {
		sessionStorage.setItem(SEARCH_CONSENT_STORAGE_KEY, JSON.stringify(consent));
		return true;
	} catch {
		return false;
	}
}

export function clearConfirmedSearchConsent(): void {
	if (!browser) return;
	try {
		sessionStorage.removeItem(SEARCH_CONSENT_STORAGE_KEY);
	} catch {
		// storage blocked — nothing to clear
	}
}
