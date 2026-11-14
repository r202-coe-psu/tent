// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parkingPopupContent } from './parking-popup';
import type { ParkingMapPoint } from '../domain/parking';

const point = (over: Partial<ParkingMapPoint> = {}): ParkingMapPoint => ({
	id: 'SH1:p1',
	shelterCode: 'SH1',
	geo: { lat: 7, lng: 100 },
	name: 'ลานหน้าอาคาร',
	note: null,
	vehicles: [],
	...over
});

describe('parkingPopupContent', () => {
	it('shows the name, the note and one line per vehicle with its capacity', () => {
		const el = parkingPopupContent(
			point({
				note: 'จอดได้เฉพาะรถยนต์',
				vehicles: [
					{ type: 'car', max_capacity: 30 },
					{ type: 'boat', max_capacity: null }
				]
			}),
			'th'
		);
		expect(el.textContent).toContain('ลานหน้าอาคาร');
		expect(el.textContent).toContain('จอดได้เฉพาะรถยนต์');
		expect(el.textContent).toContain('รถยนต์ / รถกระบะ · รองรับสูงสุด 30 คัน');
		expect(el.textContent).toContain('เรือ · ไม่ระบุจำนวน');
	});

	it('follows the language and omits an empty note', () => {
		const el = parkingPopupContent(point({ vehicles: [{ type: 'car', max_capacity: 5 }] }), 'en');
		expect(el.textContent).toContain('Cars / pickups · Up to 5 vehicles');
		expect(el.children).toHaveLength(2);
	});

	it('never parses staff text as HTML', () => {
		const el = parkingPopupContent(
			point({ name: '<b>x</b>', note: '<img src=x onerror="alert(1)">' })
		);
		expect(el.querySelector('img')).toBeNull();
		expect(el.querySelector('b')).toBeNull();
		expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
	});
});
