import { describe, expect, it } from 'vitest';
import {
	buildKioskContextQuery,
	getKioskDisplayContext,
	KIOSK_DISPLAY_QUERY_KEYS
} from './display-context';

describe('kiosk display context', () => {
	it('uses the approved fallbacks when context is missing', () => {
		expect(getKioskDisplayContext({})).toEqual({
			shelterName: 'ศูนย์พักพิง',
			shelterCode: '',
			stationName: 'จุดคัดกรองทั่วไป',
			deviceName: 'Kiosk'
		});
	});

	it('trims display context values', () => {
		expect(
			getKioskDisplayContext({
				shelter_name: '  ศูนย์ทดสอบ  ',
				shelter_code: ' SH001 ',
				station_name: '  จุด 1 ',
				device_name: '  Kiosk 1 '
			})
		).toEqual({
			shelterName: 'ศูนย์ทดสอบ',
			shelterCode: 'SH001',
			stationName: 'จุด 1',
			deviceName: 'Kiosk 1'
		});
	});

	it('serializes only the allowlisted context keys', () => {
		const query = new URLSearchParams(
			buildKioskContextQuery({
				shelterName: 'ศูนย์/หนึ่ง',
				shelterCode: 'SH001',
				stationName: 'จุด 1',
				deviceName: 'Kiosk 1'
			})
		);

		expect([...query.keys()].sort()).toEqual([...KIOSK_DISPLAY_QUERY_KEYS].sort());
		expect(query.get('shelter_name')).toBe('ศูนย์/หนึ่ง');
		expect(query.get('shelter_code')).toBe('SH001');
	});
});
