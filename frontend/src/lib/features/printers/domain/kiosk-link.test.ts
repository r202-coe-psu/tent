import { describe, expect, it } from 'vitest';
import { kioskDevicesOfShelter, kioskLinkName } from './kiosk-link';

const devices = [
	{ device_id: 'kiosk-a', name: 'ตู้ A', shelter_code: 'SH001' },
	{ device_id: 'kiosk-b', name: 'ตู้ B', shelter_code: 'SH002' },
	{ device_id: 'kiosk-c', name: 'ตู้ C', shelter_code: 'SH001' }
];

describe('kioskDevicesOfShelter', () => {
	it('keeps only the scanners of the printer shelter, whatever the code casing', () => {
		expect(kioskDevicesOfShelter(devices, 'sh001').map((d) => d.device_id)).toEqual([
			'kiosk-a',
			'kiosk-c'
		]);
	});
});

describe('kioskLinkName', () => {
	it('names the linked scanner', () => {
		expect(kioskLinkName('kiosk-b', devices)).toBe('ตู้ B');
	});

	it('falls back to the device id when the scanner is not in the list', () => {
		expect(kioskLinkName('kiosk-z', devices)).toBe('kiosk-z');
	});

	it('returns null when the printer is not linked', () => {
		expect(kioskLinkName(null, devices)).toBeNull();
		expect(kioskLinkName(undefined, devices)).toBeNull();
	});
});
