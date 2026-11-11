import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardToUnifiedMember, type ScannerCard } from './scanner-card';
import { blankUnifiedMember } from './unified-registration';

function card(over: Partial<ScannerCard> = {}): ScannerCard {
	return {
		citizen_id: '1234567890121',
		first_name_th: 'สมชาย',
		last_name_th: 'ใจดี',
		gender: 'male',
		...over
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('cardToUnifiedMember demographics', () => {
	it('maps the card gender and its CE birth year to gender and Buddhist-Era birth year', () => {
		const member = cardToUnifiedMember(
			card({ gender: 'female', birth_year_ce: 1992, age: 33 }),
			blankUnifiedMember()
		);

		expect(member.gender).toBe('female');
		expect(member.birth_year).toBe(2535);
		expect(member.age).toBe(33);
	});

	it('derives the age from the Buddhist-Era birth year when the card carries no age', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));

		const member = cardToUnifiedMember(card({ birth_year_ce: 1992 }), blankUnifiedMember());

		expect(member.birth_year).toBe(2535);
		expect(member.age).toBe(34);
	});

	it('leaves the birth year and age unchanged when the card has no birth year', () => {
		const base = { ...blankUnifiedMember(), birth_year: 2540, age: 29 };

		const member = cardToUnifiedMember(card({ gender: 'other' }), base);

		expect(member.gender).toBe('other');
		expect(member.birth_year).toBe(2540);
		expect(member.age).toBe(29);
	});
});
