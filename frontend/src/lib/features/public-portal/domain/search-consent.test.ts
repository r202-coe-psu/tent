import { describe, expect, it } from 'vitest';
import { parseSearchConsent, type SearchConsentInput } from './search-consent';

const valid: SearchConsentInput = {
	searcher: { first_name: 'สมชาย', last_name: 'ใจดี', phone: '0812345678' },
	purpose: 'find_family',
	consent_accepted: true
};

function errorsOf(input: unknown) {
	const result = parseSearchConsent(input);
	if (result.ok) throw new Error('expected failure');
	return Object.keys(result.errors).sort();
}

describe('parseSearchConsent', () => {
	it('accepts a valid body and omits purpose_note for non-other purposes', () => {
		const result = parseSearchConsent(valid);
		expect(result).toEqual({ ok: true, consent: valid });
		if (result.ok) expect('purpose_note' in result.consent).toBe(false);
	});

	it.each([[''], ['  '], [null], [undefined]])(
		'treats a blank purpose_note (%j) as omitted for non-other',
		(note) => {
			const result = parseSearchConsent({ ...valid, purpose_note: note });
			expect(result.ok).toBe(true);
			if (result.ok) expect('purpose_note' in result.consent).toBe(false);
		}
	);

	it('rejects a real purpose_note on a non-other purpose', () => {
		expect(errorsOf({ ...valid, purpose_note: 'x' })).toEqual(['purpose_note']);
	});

	it('requires a trimmed 1-200 char purpose_note for other', () => {
		expect(errorsOf({ ...valid, purpose: 'other' })).toEqual(['purpose_note']);
		expect(errorsOf({ ...valid, purpose: 'other', purpose_note: '   ' })).toEqual(['purpose_note']);
		expect(errorsOf({ ...valid, purpose: 'other', purpose_note: 'x'.repeat(201) })).toEqual([
			'purpose_note'
		]);
		const ok = parseSearchConsent({ ...valid, purpose: 'other', purpose_note: '  ธุระ  ' });
		expect(ok.ok && ok.consent).toMatchObject({ purpose: 'other', purpose_note: 'ธุระ' });
	});

	it('trims names, requires first name, caps both at 100', () => {
		const ok = parseSearchConsent({
			...valid,
			searcher: { ...valid.searcher, first_name: '  สมชาย ', last_name: ' ' }
		});
		expect(ok.ok && ok.consent.searcher).toMatchObject({ first_name: 'สมชาย', last_name: '' });
		expect(errorsOf({ ...valid, searcher: { ...valid.searcher, first_name: '  ' } })).toEqual([
			'first_name'
		]);
		expect(
			errorsOf({ ...valid, searcher: { ...valid.searcher, first_name: 'ก'.repeat(101) } })
		).toEqual(['first_name']);
		expect(
			errorsOf({ ...valid, searcher: { ...valid.searcher, last_name: 'ก'.repeat(101) } })
		).toEqual(['last_name']);
	});

	it('defaults a missing last_name to empty (single-name people)', () => {
		const ok = parseSearchConsent({
			...valid,
			searcher: { first_name: 'สมชาย', phone: '0812345678' }
		});
		expect(ok.ok && ok.consent.searcher.last_name).toBe('');
	});

	it('accepts only a 10-digit 0-prefixed phone, ignoring typed separators', () => {
		const ok = parseSearchConsent({
			...valid,
			searcher: { ...valid.searcher, phone: '081-234 5678' }
		});
		expect(ok.ok && ok.consent.searcher.phone).toBe('0812345678');
		for (const phone of ['', '812345678', '08123456789', '1812345678', '+66812345678', 'abc']) {
			expect(errorsOf({ ...valid, searcher: { ...valid.searcher, phone } })).toEqual(['phone']);
		}
	});

	it('requires consent to be exactly true and a known purpose', () => {
		expect(errorsOf({ ...valid, consent_accepted: false })).toEqual(['consent_accepted']);
		expect(errorsOf({ ...valid, consent_accepted: undefined })).toEqual(['consent_accepted']);
		expect(errorsOf({ ...valid, purpose: 'spy' })).toEqual(['purpose']);
	});
});
