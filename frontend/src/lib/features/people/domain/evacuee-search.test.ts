import { describe, it, expect } from 'vitest';
import {
	evacueeSearchClauses,
	matchesEvacueeSearchPlan,
	parseEvacueeSearchQuery,
	type EvacueeSearchPlan
} from './evacuee-search';
import type { Evacuee } from './people';

const ULID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';

function ev(over: Partial<Evacuee> & Record<string, unknown> = {}): Evacuee {
	return {
		_id: `evacuee:${ULID}`,
		type: 'evacuee',
		first_name: 'Somchai',
		last_name: 'Jaidee',
		phone: '0812345678',
		person_id: { cardType: 'national_id', number: '1234567890123' },
		...over
	} as unknown as Evacuee;
}

const plan = (q: string) => parseEvacueeSearchQuery(q);
const matches = (e: Evacuee, q: string) => matchesEvacueeSearchPlan(e, plan(q));

describe('parseEvacueeSearchQuery', () => {
	it.each(['', '   ', '\t\n'])('classifies blank %j as empty', (q) => {
		expect(plan(q)).toEqual({ kind: 'empty' });
	});

	it('classifies one word as a single-word name query', () => {
		expect(plan('  Somchai ')).toEqual({ kind: 'name', first: 'Somchai', last: null });
	});

	it('splits several words into first name and the rest as last name', () => {
		expect(plan('สมชาย   ใจ')).toEqual({ kind: 'name', first: 'สมชาย', last: 'ใจ' });
		expect(plan('Anna  Maria   Smith')).toEqual({
			kind: 'name',
			first: 'Anna',
			last: 'Maria Smith'
		});
	});

	it.each([
		['0812345678', '0812345678'],
		['081', '081'],
		['081-234-5678', '0812345678'],
		['(081) 234.5678', '0812345678'],
		['+66 81-234', '081234'],
		['66812345678', '0812345678'],
		['+66812345678', '0812345678']
	])('classifies %j as a phone prefix %j', (q, prefix) => {
		expect(plan(q)).toEqual({ kind: 'phone', prefix });
	});

	it('treats a 13-digit number as a card, not a phone', () => {
		expect(plan('1234567890123')).toEqual({ kind: 'card', numbers: ['1234567890123'] });
		expect(plan('1-2345-67890-12-3')).toEqual({ kind: 'card', numbers: ['1234567890123'] });
	});

	it('treats other digit strings that are not phone prefixes as a card', () => {
		expect(plan('12345')).toEqual({ kind: 'card', numbers: ['12345'] });
		expect(plan('08123456789')).toEqual({ kind: 'card', numbers: ['08123456789'] });
	});

	it('treats a token mixing letters and digits as a card with a case variant', () => {
		expect(plan('aa1234567')).toEqual({ kind: 'card', numbers: ['aa1234567', 'AA1234567'] });
		expect(plan('AA1234567')).toEqual({ kind: 'card', numbers: ['AA1234567'] });
	});

	it('keeps the dash of an anonymous id as one of its variants', () => {
		const anon = `ANON-${ULID}`;
		expect(plan(anon)).toEqual({ kind: 'card', numbers: [anon, `ANON${ULID}`] });
	});

	it('does not read letters and digits across several words as a card', () => {
		expect(plan('AA 1234567')).toEqual({ kind: 'name', first: 'AA', last: '1234567' });
	});

	it.each([
		[`/onsite/zoning/evacuee:${ULID}`],
		[`https://x.test/onsite/medical-screening/evacuee:${ULID}?a=1`],
		[`https://x.test/page?evacuee_id=evacuee:${ULID}`],
		[`evacuee:${ULID}`],
		[`EVACUEE:${ULID}`],
		[ULID],
		[ULID.toLowerCase()]
	])('classifies scan input %j as a scan of the uppercase evacuee id', (q) => {
		expect(plan(q)).toEqual({ kind: 'scan', id: `evacuee:${ULID}` });
	});

	it('does not treat an ordinary 26-letter-or-short word as a scan', () => {
		expect(plan('Somchaiiiiiiiiiiiiiiiiiiiiii')).toMatchObject({ kind: 'name' });
		expect(plan('ULID')).toMatchObject({ kind: 'name' });
	});
});

describe('evacueeSearchClauses', () => {
	it('issues no clause for empty and scan plans', () => {
		expect(evacueeSearchClauses({ kind: 'empty' })).toEqual([]);
		expect(evacueeSearchClauses({ kind: 'scan', id: `evacuee:${ULID}` })).toEqual([]);
	});

	it('starts every prefix range at the lowercase form so a whole word typed in capitals still finds mixed-case names', () => {
		// CouchDB ICU collation sorts `Kittipong` below `KITTIPONG`; a capitalised lower bound would skip it.
		const [first] = evacueeSearchClauses(plan('KITTIPONG'));
		expect(first.selector).toMatchObject({ first_name: { $gte: 'kittipong' } });
	});

	it('issues one prefix range per name field for a single word', () => {
		const clauses = evacueeSearchClauses(plan('Som'));
		expect(clauses.map((c) => c.key)).toEqual(['first_name', 'last_name', 'nickname']);
		expect(clauses[0].selector).toEqual({
			type: 'evacuee',
			first_name: { $gte: 'som', $lt: 'Som\ufff0' }
		});
	});

	it('combines first and last name ranges in one clause for several words', () => {
		const clauses = evacueeSearchClauses(plan('Som Jai'));
		expect(clauses).toHaveLength(1);
		expect(clauses[0].selector).toEqual({
			type: 'evacuee',
			first_name: { $gte: 'som', $lt: 'Som\ufff0' },
			last_name: { $gte: 'jai', $lt: 'Jai\ufff0' }
		});
	});

	it('ranges both phone fields for a phone prefix', () => {
		const clauses = evacueeSearchClauses(plan('081'));
		expect(clauses.map((c) => c.key)).toEqual(['phone', 'emergency_contact.phone']);
		expect(clauses[1].selector).toEqual({
			type: 'evacuee',
			'emergency_contact.phone': { $gte: '081', $lt: '081\ufff0' }
		});
	});

	it('uses exact equality, one clause per variant, for a card', () => {
		const clauses = evacueeSearchClauses(plan('aa1234567'));
		expect(clauses.map((c) => c.selector)).toEqual([
			{ type: 'evacuee', 'person_id.number': 'aa1234567' },
			{ type: 'evacuee', 'person_id.number': 'AA1234567' }
		]);
		expect(new Set(clauses.map((c) => c.key)).size).toBe(clauses.length);
	});
});

describe('matchesEvacueeSearchPlan', () => {
	it('matches a name prefix regardless of English case', () => {
		expect(matches(ev(), 'som')).toBe(true);
		expect(matches(ev({ first_name: 'SOMBAT' }), 'Som')).toBe(true);
		expect(matches(ev(), 'jai')).toBe(true);
		expect(matches(ev({ nickname: 'Nong' }), 'nong')).toBe(true);
	});

	it('does not match a name infix', () => {
		expect(matches(ev(), 'chai')).toBe(false);
	});

	it('matches the literal Thai prefix only', () => {
		expect(matches(ev({ first_name: 'สมชาย' }), 'ส')).toBe(true);
		expect(matches(ev({ first_name: 'เสือ' }), 'ส')).toBe(false);
		expect(matches(ev({ first_name: 'ส้ม' }), 'สม')).toBe(false);
	});

	it('requires the first word on first name and the rest on a partial last name', () => {
		const e = ev({ first_name: 'สมชาย', last_name: 'ใจดี' });
		expect(matches(e, 'สมชาย ใจ')).toBe(true);
		expect(matches(e, 'สม ใจดี')).toBe(true);
		expect(matches(e, 'ใจ สมชาย')).toBe(false);
		expect(matches(e, 'สมชาย ดี')).toBe(false);
	});

	it('collapses whitespace in the stored name before comparing', () => {
		expect(matches(ev({ last_name: 'Van  Dyke' }), 'Somchai Van D')).toBe(true);
	});

	it('matches a phone prefix on the own or emergency-contact phone', () => {
		const e = ev({ phone: '0812345678', emergency_contact: { phone: '089-999-0000' } as never });
		expect(matches(e, '0812')).toBe(true);
		expect(matches(e, '+66 81-234')).toBe(true);
		expect(matches(e, '08999')).toBe(true);
		expect(matches(e, '0823')).toBe(false);
	});

	it('matches a card only by exact number', () => {
		expect(matches(ev(), '1234567890123')).toBe(true);
		expect(matches(ev(), '123456789012')).toBe(false);
		expect(
			matches(
				ev({ person_id: { cardType: 'passport', number: 'AA1234567' } as never }),
				'aa1234567'
			)
		).toBe(true);
		expect(
			matches(ev({ person_id: { cardType: 'passport', number: 'AA1234567' } as never }), 'AA12345')
		).toBe(false);
	});

	it('matches a scan only by the exact id and never an empty plan', () => {
		expect(matches(ev(), ULID)).toBe(true);
		expect(matches(ev({ _id: 'evacuee:01J8Z3K4M5N6P7Q8R9S0T1V2W4' }), ULID)).toBe(false);
		const empty: EvacueeSearchPlan = { kind: 'empty' };
		expect(matchesEvacueeSearchPlan(ev(), empty)).toBe(false);
	});
});
