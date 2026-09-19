import { describe, it, expect } from 'vitest';
import { isControlledSkill, initialStatusForSkills, DEFAULT_CONTROLLED_SKILLS } from './skills';

describe('isControlledSkill', () => {
	it('matches a default controlled skill (English)', () => {
		expect(isControlledSkill('medical')).toBe(true);
		expect(isControlledSkill('nursing')).toBe(true);
	});

	it('matches a default controlled skill (Thai)', () => {
		expect(isControlledSkill('พยาบาล')).toBe(true);
	});

	it('matches ปฐมพยาบาล (first aid) — CR-094 FR-VOL-10.3 / schema.md §2.17 example', () => {
		expect(isControlledSkill('ปฐมพยาบาล')).toBe(true);
		expect(isControlledSkill('first aid')).toBe(true);
	});

	it('is case- and whitespace-insensitive', () => {
		expect(isControlledSkill('  MEDICAL  ')).toBe(true);
	});

	it('matches text normalized differently (NFD-decomposed) via NFC normalization', () => {
		// NFD form: base character followed by a combining vowel sign, rather
		// than the single precomposed NFC codepoint — a common artifact of text
		// pasted from other sources.
		const nfd = 'ปฐมพยาบาล'.normalize('NFD');
		expect(isControlledSkill(nfd)).toBe(true);
	});

	it('is false for a non-controlled skill', () => {
		expect(isControlledSkill('ครัว')).toBe(false);
		expect(isControlledSkill('driving')).toBe(false);
	});

	it('honors an explicit controlled-skill list, overriding the default', () => {
		expect(isControlledSkill('ครัว', ['ครัว'])).toBe(true);
		expect(isControlledSkill('medical', ['ครัว'])).toBe(false);
	});
});

describe('initialStatusForSkills', () => {
	const autoAcceptJob = { auto_accept: true, tier: 'operational' as const };
	const staffCapableJob = { auto_accept: true, tier: 'staff-capable' as const };
	const manualJob = { auto_accept: false, tier: 'operational' as const };

	it('is pending_review when a controlled skill is present, even if the job auto-accepts', () => {
		expect(initialStatusForSkills(['ขับรถ', 'medical'], autoAcceptJob)).toBe('pending_review');
		expect(initialStatusForSkills(['nursing'], autoAcceptJob)).toBe('pending_review');
	});

	it('is pending_review when a controlled skill is present and the job does not auto-accept', () => {
		expect(initialStatusForSkills(['medical'], manualJob)).toBe('pending_review');
	});

	it('is confirmed when no controlled skill is present and the job auto-accepts', () => {
		expect(initialStatusForSkills(['ขับรถ', 'ครัว'], autoAcceptJob)).toBe('confirmed');
	});

	it('is pending_review — NOT confirmed — when no controlled skill is present but the job does not auto-accept (F2)', () => {
		expect(initialStatusForSkills(['ขับรถ', 'ครัว'], manualJob)).toBe('pending_review');
	});

	it('is pending_review for an empty skills list when the job does not auto-accept', () => {
		expect(initialStatusForSkills([], manualJob)).toBe('pending_review');
	});

	it('is confirmed for an empty skills list when the job auto-accepts', () => {
		expect(initialStatusForSkills([], autoAcceptJob)).toBe('confirmed');
	});

	it('respects an explicit controlled-skill list', () => {
		expect(initialStatusForSkills(['ครัว'], autoAcceptJob, ['ครัว'])).toBe('pending_review');
		expect(initialStatusForSkills(['medical'], autoAcceptJob, ['ครัว'])).toBe('confirmed');
	});

	it('default controlled list is non-empty', () => {
		expect(DEFAULT_CONTROLLED_SKILLS.length).toBeGreaterThan(0);
	});

	it('never confirms a staff-capable job even when auto_accept is set (D5)', () => {
		// F-AUTO forbids this doc shape, but an unvalidated doc read back from
		// CouchDB can still carry it — and a staff-capable confirmation is what
		// later drives a RoleKey grant (CR-094 FR-VOL-05R.2).
		expect(initialStatusForSkills(['ขับรถ'], staffCapableJob)).toBe('pending_review');
		expect(initialStatusForSkills([], staffCapableJob)).toBe('pending_review');
	});

	it('requires auto_accept to be strictly true, not merely truthy (D5)', () => {
		const truthyNotTrue = { auto_accept: 'yes', tier: 'operational' } as unknown as Parameters<
			typeof initialStatusForSkills
		>[1];
		expect(initialStatusForSkills(['ขับรถ'], truthyNotTrue)).toBe('pending_review');
	});
});
