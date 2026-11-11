// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearRegistrationDraft,
	isEligibleNavigationForDraftRestore,
	loadRegistrationDraft,
	resetNavigationEligibilityCache,
	saveRegistrationDraft,
	sweepExpiredDrafts
} from './registration-draft.storage';
import { blankUnifiedMember, type UnifiedRegistrationInput } from '../domain/unified-registration';

const NOW = Date.parse('2026-11-06T10:00:00.000Z');
const KEY = 'public-pre-register';
const household = {
	address_no: '12',
	pets: []
} as unknown as UnifiedRegistrationInput['household'];
const members = [{ ...blankUnifiedMember(), first_name: 'สมชาย' }];

beforeEach(() => {
	resetNavigationEligibilityCache();
});

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

	it('sweeps expired drafts on save or sweep', () => {
		const expiredTime = NOW - 3 * 60 * 60 * 1000;
		sessionStorage.setItem(
			'tent.registrationDraft:old-draft',
			JSON.stringify({ v: 1, saved_at: expiredTime, household: {}, members: [] })
		);
		sessionStorage.setItem(
			'tent.registrationDraft:valid-draft',
			JSON.stringify({ v: 1, saved_at: NOW - 60_000, household: {}, members: [] })
		);

		sweepExpiredDrafts(NOW);
		expect(sessionStorage.getItem('tent.registrationDraft:old-draft')).toBeNull();
		expect(sessionStorage.getItem('tent.registrationDraft:valid-draft')).not.toBeNull();
	});

	it('clears draft and returns null when navigation is a fresh page open (navigate)', () => {
		saveRegistrationDraft(KEY, household, members, NOW);
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
			{ type: 'navigate' } as PerformanceNavigationTiming
		]);

		expect(isEligibleNavigationForDraftRestore()).toBe(false);
		expect(loadRegistrationDraft(KEY, NOW)).toBeNull();
		// Draft must be wiped from storage to protect privacy on shared devices
		expect(sessionStorage.getItem(`tent.registrationDraft:${KEY}`)).toBeNull();
	});

	it('keeps a draft typed after a fresh open when the form remounts in the same page (B2)', () => {
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
			{ type: 'navigate' } as PerformanceNavigationTiming
		]);
		expect(loadRegistrationDraft(KEY, NOW)).toBeNull();

		// The user types, the form unmounts (shelter full) and mounts again in the same page.
		saveRegistrationDraft(KEY, household, members, NOW);
		expect(loadRegistrationDraft(KEY, NOW)?.members[0].first_name).toBe('สมชาย');
	});

	it('never stores the ID number, medical data or emergency contact (B1/B3)', () => {
		const sensitive = [
			{
				...members[0],
				person_id: { cardType: 'national_id' as const, number: '1101700230673' },
				special_needs: ['wheelchair'],
				medical_conditions: ['diabetes'],
				medical_allergies: ['penicillin'],
				medical_medications: ['insulin'],
				emergency_contact: { name: 'ญาติ', phone: '0812345678', relation: 'sibling' }
			}
		];
		saveRegistrationDraft(KEY, household, sensitive, NOW);
		const raw = sessionStorage.getItem(`tent.registrationDraft:${KEY}`) ?? '';
		for (const secret of [
			'1101700230673',
			'wheelchair',
			'diabetes',
			'penicillin',
			'insulin',
			'0812345678'
		]) {
			expect(raw).not.toContain(secret);
		}
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
			{ type: 'reload' } as PerformanceNavigationTiming
		]);
		const restored = loadRegistrationDraft(KEY, NOW)?.members[0];
		expect(restored?.first_name).toBe('สมชาย');
		expect(restored?.person_id.number).toBe('');
	});

	it('restores draft when navigation is a reload or back/forward', () => {
		saveRegistrationDraft(KEY, household, members, NOW);
		const spy = vi.spyOn(performance, 'getEntriesByType');

		spy.mockReturnValue([{ type: 'reload' } as PerformanceNavigationTiming]);
		expect(isEligibleNavigationForDraftRestore()).toBe(true);
		expect(loadRegistrationDraft(KEY, NOW)?.members[0].first_name).toBe('สมชาย');

		spy.mockReturnValue([{ type: 'back_forward' } as PerformanceNavigationTiming]);
		expect(isEligibleNavigationForDraftRestore()).toBe(true);
		expect(loadRegistrationDraft(KEY, NOW)?.members[0].first_name).toBe('สมชาย');
	});
});
