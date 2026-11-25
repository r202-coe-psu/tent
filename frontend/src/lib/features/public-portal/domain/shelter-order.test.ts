import { describe, expect, it } from 'vitest';
import { distanceKm, haversineKm, orderShelters } from './shelter-order';

const at = (lat: number, lng: number) => ({ lat, lng });
const shelter = (
	id: string,
	extra: { is_external?: boolean; geo?: ReturnType<typeof at> | null }
) => ({
	id,
	is_external: extra.is_external ?? false,
	geo: extra.geo === undefined ? null : extra.geo
});
const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe('haversineKm / distanceKm', () => {
	it('measures about 111 km per degree of latitude', () => {
		expect(haversineKm(at(7, 100), at(8, 100))).toBeCloseTo(111.2, 0);
	});

	it('rounds to one decimal, and is null without an origin or a pin', () => {
		expect(distanceKm(at(7, 100), at(7.01, 100))).toBe(1.1);
		expect(distanceKm(null, at(7, 100))).toBeNull();
		expect(distanceKm(at(7, 100), null)).toBeNull();
	});
});

describe('orderShelters', () => {
	it('puts centres in this system before external ones, keeping the API order without an origin', () => {
		const list = [
			shelter('ext-a', { is_external: true }),
			shelter('in-a', {}),
			shelter('ext-b', { is_external: true }),
			shelter('in-b', {})
		];

		expect(ids(orderShelters(list, null))).toEqual(['in-a', 'in-b', 'ext-a', 'ext-b']);
	});

	it('orders each group closest first with an origin, shelters without a pin last', () => {
		const list = [
			shelter('ext-near', { is_external: true, geo: at(7.001, 100) }),
			shelter('in-nopin', {}),
			shelter('in-far', { geo: at(7.1, 100) }),
			shelter('in-near', { geo: at(7.01, 100) })
		];

		expect(ids(orderShelters(list, at(7, 100)))).toEqual([
			'in-near',
			'in-far',
			'in-nopin',
			'ext-near'
		]);
	});

	it('does not change the list it was given', () => {
		const list = [shelter('ext', { is_external: true }), shelter('in', {})];
		orderShelters(list, null);
		expect(ids(list)).toEqual(['ext', 'in']);
	});
});
