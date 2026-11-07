// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearRegistrationDraft,
	loadRegistrationDraft,
	saveRegistrationDraft
} from './registration-draft.storage';
import { blankUnifiedMember, type UnifiedRegistrationInput } from '../domain/unified-registration';

const NOW = Date.parse('2026-11-06T10:00:00.000Z');
const KEY = 'public-pre-register';
const household = {
	address_no: '12',
	pets: []
} as unknown as UnifiedRegistrationInput['household'];
const members = [{ ...blankUnifiedMember(), first_name: 'สมชาย' }];

afterEach(() => {
	vi.unstubAllGlobals();
	sessionStorage.clear();
});

describe('registration draft storage (#358)', () => {
	it('saves to sessionStorage and loads it back', () => {
		saveRegistrationDraft(KEY, household, members, NOW);
		expect(sessionStorage.getItem(`tent.registrationDraft:${KEY}`)).not.toBeNull();
		expect(loadRegistrationDraft(KEY, NOW)?.members[0].first_name).toBe('สมชาย');
	});

	it('clears the draft', () => {
		saveRegistrationDraft(KEY, household, members, NOW);
		clearRegistrationDraft(KEY);
		expect(loadRegistrationDraft(KEY, NOW)).toBeNull();
	});

	it('removes a stale or broken draft when it reads one', () => {
		sessionStorage.setItem(`tent.registrationDraft:${KEY}`, '{"v":1,"saved_at":0}');
		expect(loadRegistrationDraft(KEY, NOW)).toBeNull();
		expect(sessionStorage.getItem(`tent.registrationDraft:${KEY}`)).toBeNull();

		sessionStorage.setItem(`tent.registrationDraft:${KEY}`, 'not json');
		expect(loadRegistrationDraft(KEY, NOW)).toBeNull();
	});

	it('keeps the form working when storage is blocked or full', () => {
		const refuse = () => {
			throw new DOMException('blocked', 'SecurityError');
		};
		vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
		expect(() => saveRegistrationDraft(KEY, household, members, NOW)).not.toThrow();
		expect(loadRegistrationDraft(KEY, NOW)).toBeNull();
		expect(() => clearRegistrationDraft(KEY)).not.toThrow();
	});
});
