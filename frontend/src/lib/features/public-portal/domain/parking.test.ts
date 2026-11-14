import { describe, it, expect } from 'vitest';
import { takesAllParkingTypes, toParkingMapPoints, wantedParkingTypes } from './parking';

describe('parking filter (CR-253 FR-33/FR-34)', () => {
	it('reads the ticked types from the URL', () => {
		const url = new URL('http://x/shelters?parking_car=on&parking_boat=on&parking_motorcycle=off');
		expect(wantedParkingTypes(url.searchParams)).toEqual(['car', 'boat']);
		expect(wantedParkingTypes(new URL('http://x/shelters').searchParams)).toEqual([]);
	});

	it('keeps a shelter only when it takes every ticked type', () => {
		expect(takesAllParkingTypes(['car', 'boat'], ['car', 'boat'])).toBe(true);
		expect(takesAllParkingTypes(['car'], ['car', 'boat'])).toBe(false);
		expect(takesAllParkingTypes([], [])).toBe(true);
		expect(takesAllParkingTypes([], ['car'])).toBe(false);
	});
});

describe('toParkingMapPoints (FR-30)', () => {
	const point = (id: string, lat: number | null) =>
		({ id, name: id, note: null, geo: { lat, lng: 100 }, vehicles: [] }) as never;

	it('flattens the points of every shelter and namespaces ids by shelter', () => {
		const pins = toParkingMapPoints([
			{ code: 'SH1', parking_points: [point('a', 7), point('b', 8)] },
			{ code: 'SH2', parking_points: [point('a', 9)] },
			{ code: 'SH3', parking_points: [] }
		]);
		expect(pins.map((p) => p.id)).toEqual(['SH1:a', 'SH1:b', 'SH2:a']);
		expect(pins[0].shelterCode).toBe('SH1');
	});

	it('skips a point without usable coordinates', () => {
		expect(
			toParkingMapPoints([{ code: 'SH1', parking_points: [point('a', null), point('b', 7)] }]).map(
				(p) => p.id
			)
		).toEqual(['SH1:b']);
	});
});
