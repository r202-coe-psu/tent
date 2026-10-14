import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001'
}));

import {
	getEvacueeSelectionError,
	resolveEvacueeName,
	formatEvacueeFullName,
	EVACUEE_NAME_FALLBACK
} from './referral.ui-helpers';

describe('getEvacueeSelectionError', () => {
	it('returns the Thai required-selection message when no evacuee is selected', () => {
		expect(getEvacueeSelectionError([])).toBe('กรุณาเลือกผู้ประสบภัยอย่างน้อย 1 คน');
	});

	it('returns undefined when at least one evacuee is selected', () => {
		expect(getEvacueeSelectionError(['evacuee:01A'])).toBeUndefined();
		expect(getEvacueeSelectionError(['evacuee:01A', 'evacuee:01B'])).toBeUndefined();
	});
});

describe('resolveEvacueeName', () => {
	const roster = { first_name: 'สมชาย', last_name: 'ใจดี' };
	const summary = { first_name: 'สมหญิง', last_name: 'รักดี' };

	it('prefers the roster name over the summary', () => {
		expect(resolveEvacueeName(roster, summary)).toBe('สมชาย ใจดี');
	});

	it('falls back to the summary when the roster has no match', () => {
		expect(resolveEvacueeName(undefined, summary)).toBe('สมหญิง รักดี');
		expect(resolveEvacueeName(null, summary)).toBe('สมหญิง รักดี');
	});

	it('returns the shared fallback text when no source has a name', () => {
		expect(resolveEvacueeName()).toBe(EVACUEE_NAME_FALLBACK);
		expect(resolveEvacueeName(undefined, undefined)).toBe('ไม่พบชื่อผู้ประสบภัย');
	});
});

describe('formatEvacueeFullName', () => {
	it('joins first and last name with one space', () => {
		expect(formatEvacueeFullName({ first_name: 'สมชาย', last_name: 'ใจดี' })).toBe('สมชาย ใจดี');
	});

	it('omits an empty, blank or missing last name (mononym) without a trailing space', () => {
		expect(formatEvacueeFullName({ first_name: 'ทดสอบ', last_name: '' })).toBe('ทดสอบ');
		expect(formatEvacueeFullName({ first_name: 'ทดสอบ', last_name: '  ' })).toBe('ทดสอบ');
		expect(formatEvacueeFullName({ first_name: 'ทดสอบ' })).toBe('ทดสอบ');
		expect(resolveEvacueeName({ first_name: 'ทดสอบ', last_name: '' })).toBe('ทดสอบ');
	});
});
