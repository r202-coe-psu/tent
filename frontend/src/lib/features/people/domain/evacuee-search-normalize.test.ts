import { describe, expect, it } from 'vitest';
import {
	normalizeEvacueeSearchFields,
	normalizeSearchCardNumber,
	normalizeSearchPhone,
	planEvacueeSearchNormalize,
	type SearchNormalizeCandidate
} from './evacuee-search-normalize';
import { parseEvacueeSearchQuery } from './evacuee-search';

const NOW = new Date('2026-11-18T00:00:00.000Z');

describe('normalizeSearchPhone', () => {
	it.each([
		['+66 81-234-5678', '0812345678'],
		['66812345678', '0812345678'],
		['081-234-5678', '0812345678'],
		[' 081 234 5678 ', '0812345678']
	])('normalizes %s to %s', (raw, expected) => {
		expect(normalizeSearchPhone(raw)).toEqual({ kind: 'normalized', value: expected });
	});

	it('leaves an already-canonical or blank value unchanged', () => {
		expect(normalizeSearchPhone('0812345678')).toEqual({ kind: 'unchanged' });
		expect(normalizeSearchPhone('')).toEqual({ kind: 'unchanged' });
		expect(normalizeSearchPhone(null)).toEqual({ kind: 'unchanged' });
	});

	it('reports a value that cannot become a 10-digit mobile', () => {
		expect(normalizeSearchPhone('02-123-456')).toEqual({ kind: 'invalid' });
		expect(normalizeSearchPhone('call me')).toEqual({ kind: 'invalid' });
	});
});

describe('normalizeSearchCardNumber', () => {
	it('strips dashes and spaces from a 13-digit national id', () => {
		expect(normalizeSearchCardNumber('national_id', '1-1037-00123-45-6')).toEqual({
			kind: 'normalized',
			value: '1103700123456'
		});
		expect(normalizeSearchCardNumber(undefined, '1 1037 00123 45 6')).toEqual({
			kind: 'normalized',
			value: '1103700123456'
		});
	});

	it('reports a national id that is not 13 digits after stripping', () => {
		expect(normalizeSearchCardNumber('national_id', '1-1037-001')).toEqual({ kind: 'invalid' });
		expect(normalizeSearchCardNumber('national_id', 'x-xxxx-xxxxx-45-6')).toEqual({
			kind: 'invalid'
		});
	});

	it('upper-cases and removes whitespace for other card types, keeping dashes', () => {
		expect(normalizeSearchCardNumber('passport', 'aa 1234567')).toEqual({
			kind: 'normalized',
			value: 'AA1234567'
		});
		expect(normalizeSearchCardNumber('pink_card', 'pk-001')).toEqual({
			kind: 'normalized',
			value: 'PK-001'
		});
		expect(normalizeSearchCardNumber('other', 'AB12')).toEqual({ kind: 'unchanged' });
	});

	it('never touches an anonymous id', () => {
		expect(normalizeSearchCardNumber('anonymous', 'anon-01hzxabc')).toEqual({ kind: 'unchanged' });
	});
});

describe('normalizeEvacueeSearchFields', () => {
	it('rewrites every fixable field, keeps the rest of the doc and stamps updated_at', () => {
		const doc = {
			_id: 'evacuee:1',
			_rev: '1-a',
			first_name: 'สมชาย',
			phone: '+66 81-234-5678',
			emergency_contact: { name: 'แม่', phone: '089 999 0000' },
			person_id: { cardType: 'national_id', number: '1-1037-00123-45-6' },
			updated_at: '2026-01-01T00:00:00.000Z'
		};
		const { doc: next, invalid } = normalizeEvacueeSearchFields(doc, NOW);
		expect(invalid).toEqual([]);
		expect(next).toEqual({
			...doc,
			phone: '0812345678',
			emergency_contact: { name: 'แม่', phone: '0899990000' },
			person_id: { cardType: 'national_id', number: '1103700123456' },
			updated_at: NOW.toISOString()
		});
	});

	it('returns no doc when nothing changes, but still reports invalid values', () => {
		const doc = { _id: 'evacuee:2', phone: '02-123-456', person_id: { number: '1103700123456' } };
		expect(normalizeEvacueeSearchFields(doc, NOW)).toEqual({ doc: null, invalid: ['phone'] });
	});

	it('normalizes the fixable field while leaving an invalid one untouched', () => {
		const doc = {
			_id: 'evacuee:3',
			phone: '+66812345678',
			person_id: { cardType: 'national_id', number: '123' }
		};
		const { doc: next, invalid } = normalizeEvacueeSearchFields(doc, NOW);
		expect(invalid).toEqual(['person_id.number']);
		expect(next?.phone).toBe('0812345678');
		expect(next?.person_id?.number).toBe('123');
	});

	it('produces values the server search query form matches', () => {
		const doc = { _id: 'evacuee:4', phone: '+66 81-234-5678' };
		const next = normalizeEvacueeSearchFields(doc, NOW).doc;
		const plan = parseEvacueeSearchQuery('081');
		expect(plan).toEqual({ kind: 'phone', prefix: '081' });
		expect(next?.phone?.startsWith('081')).toBe(true);
	});
});

describe('planEvacueeSearchNormalize', () => {
	const evacuees: SearchNormalizeCandidate[] = [
		{ _id: 'evacuee:a', phone: '+66812345678' },
		{ _id: 'evacuee:b', phone: '0812345678' },
		{ _id: 'evacuee:c', phone: 'unknown', person_id: { cardType: 'national_id', number: '12' } }
	];

	it('counts scanned, normalized, unchanged and invalid values', () => {
		const { updates, counts } = planEvacueeSearchNormalize(evacuees, NOW);
		expect(updates.map((u) => u._id)).toEqual(['evacuee:a']);
		expect(counts).toEqual({
			scanned: 3,
			normalized: 1,
			unchanged: 2,
			withInvalid: 1,
			invalidByField: { phone: 1, 'emergency_contact.phone': 0, 'person_id.number': 1 }
		});
	});

	it('plans 0 updates on a second run over the written docs', () => {
		const first = planEvacueeSearchNormalize(evacuees, NOW);
		const written = evacuees.map((e) => first.updates.find((u) => u._id === e._id) ?? e);
		expect(planEvacueeSearchNormalize(written, NOW).updates).toEqual([]);
	});
});
