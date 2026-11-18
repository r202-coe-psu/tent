import { describe, expect, it } from 'vitest';
import { haversineKm, rankByUserOrigin, sortByDistance } from './shelter-geo';

const shelter = (id: string, geo: { lat: number; lng: number } | null, distance = 0) => ({
	id,
	geo,
	distance
});

describe('haversineKm', () => {
	it('is 0 for the same point', () => {
		expect(haversineKm(7.0086, 100.4747, 7.0086, 100.4747)).toBe(0);
	});

	it('measures Hat Yai to Songkhla at about 25 km', () => {
		const km = haversineKm(7.0086, 100.4747, 7.1897, 100.5951);
		expect(km).toBeGreaterThan(20);
		expect(km).toBeLessThan(30);
	});

	it('is symmetric', () => {
		expect(haversineKm(7, 100, 8, 101)).toBeCloseTo(haversineKm(8, 101, 7, 100), 9);
	});
});

describe('sortByDistance', () => {
	it('puts the nearest first and sinks shelters without a pin', () => {
		const sorted = sortByDistance([
			shelter('far', { lat: 1, lng: 1 }, 9),
			shelter('nopin', null, 0),
			shelter('near', { lat: 1, lng: 1 }, 2)
		]);
		expect(sorted.map((s) => s.id)).toEqual(['near', 'far', 'nopin']);
	});

	it('does not change the array it is given', () => {
		const input = [shelter('b', { lat: 1, lng: 1 }, 5), shelter('a', { lat: 1, lng: 1 }, 1)];
		sortByDistance(input);
		expect(input.map((s) => s.id)).toEqual(['b', 'a']);
	});
});

describe('rankByUserOrigin', () => {
	const hatYai = { lat: 7.0086, lng: 100.4747 };
	const songkhla = { lat: 7.1897, lng: 100.5951 };

	it('returns the list untouched while there is no search origin', () => {
		const list = [shelter('a', hatYai, 3), shelter('b', null)];
		expect(rankByUserOrigin(list, '', '')).toEqual(list);
		expect(rankByUserOrigin(list, '7.0', '')).toEqual(list);
		expect(rankByUserOrigin(list, '', '')).not.toBe(list);
	});

	it('measures each pinned shelter from the origin, to one decimal, and sorts closest first', () => {
		const ranked = rankByUserOrigin(
			[shelter('songkhla', songkhla), shelter('here', hatYai), shelter('nopin', null, 4)],
			'7.0086',
			'100.4747'
		);

		expect(ranked.map((s) => s.id)).toEqual(['here', 'songkhla', 'nopin']);
		expect(ranked[0].distance).toBe(0);
		expect(ranked[1].distance).toBeGreaterThan(20);
		expect(String(ranked[1].distance)).toMatch(/^\d+(\.\d)?$/);
		// A shelter with no pin keeps what the list gave it.
		expect(ranked[2].distance).toBe(4);
	});

	it('ignores an origin that is not a number', () => {
		const list = [shelter('a', hatYai, 3)];
		expect(rankByUserOrigin(list, 'abc', '100')[0].distance).toBe(3);
	});
});
