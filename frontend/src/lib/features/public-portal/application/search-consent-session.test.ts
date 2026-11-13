// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import {
	clearConfirmedSearchConsent,
	getConfirmedSearchConsent,
	SEARCH_CONSENT_STORAGE_KEY,
	storeConfirmedSearchConsent
} from './search-consent-session';
import type { SearchConsent } from '../domain/search-consent';

const CONSENT: SearchConsent = {
	searcher: { first_name: 'สมชาย', last_name: '', phone: '0812345678' },
	purpose: 'find_family',
	consent_accepted: true
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('search consent session', () => {
	it('round-trips a confirmed consent', () => {
		expect(getConfirmedSearchConsent()).toBeNull();
		expect(storeConfirmedSearchConsent(CONSENT)).toBe(true);
		expect(getConfirmedSearchConsent()).toEqual(CONSENT);
		clearConfirmedSearchConsent();
		expect(getConfirmedSearchConsent()).toBeNull();
	});

	it('treats corrupt or invalid stored values as not confirmed', () => {
		sessionStorage.setItem(SEARCH_CONSENT_STORAGE_KEY, '{not json');
		expect(getConfirmedSearchConsent()).toBeNull();
		sessionStorage.setItem(SEARCH_CONSENT_STORAGE_KEY, JSON.stringify({ purpose: 'find_family' }));
		expect(getConfirmedSearchConsent()).toBeNull();
	});

	it('survives blocked storage: read = not confirmed, write = false', () => {
		const blocked = () => {
			throw new DOMException('blocked', 'SecurityError');
		};
		vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
		expect(getConfirmedSearchConsent()).toBeNull();
		expect(storeConfirmedSearchConsent(CONSENT)).toBe(false);
	});
});
