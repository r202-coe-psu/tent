import { describe, it, expect } from 'vitest';
import { vehicleCapacityText, vehicleLabel } from './vehicle-types';

describe('vehicle type wording', () => {
	it('names a type in Thai and English, falling back to Thai and then to the code', () => {
		expect(vehicleLabel('car', 'th')).toBe('รถยนต์ / รถกระบะ');
		expect(vehicleLabel('car', 'en')).toBe('Cars / pickups');
		expect(vehicleLabel('car', undefined)).toBe('รถยนต์ / รถกระบะ');
		expect(vehicleLabel('hovercraft', 'en')).toBe('hovercraft');
	});

	it('counts boats in its own unit and says when no capacity is set', () => {
		expect(vehicleCapacityText('car', 30, 'th')).toBe('รองรับสูงสุด 30 คัน');
		expect(vehicleCapacityText('boat', 10, 'th')).toBe('รองรับสูงสุด 10 ลำ');
		expect(vehicleCapacityText('car', 5, 'en')).toBe('Up to 5 vehicles');
		expect(vehicleCapacityText('boat', null, 'en')).toBe('Capacity not set');
	});
});
