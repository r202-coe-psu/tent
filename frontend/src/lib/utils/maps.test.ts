import { describe, expect, it } from 'vitest';
import { directionsUrl } from './maps';

describe('directionsUrl', () => {
	it('puts lat,lng in the destination parameter', () => {
		expect(directionsUrl({ lat: 7.0086, lng: 100.4747 })).toBe(
			'https://www.google.com/maps/dir/?api=1&destination=7.0086,100.4747'
		);
	});

	it('keeps negative and integer coordinates as plain numbers', () => {
		expect(directionsUrl({ lat: -6, lng: -122.4194 })).toBe(
			'https://www.google.com/maps/dir/?api=1&destination=-6,-122.4194'
		);
	});
});
