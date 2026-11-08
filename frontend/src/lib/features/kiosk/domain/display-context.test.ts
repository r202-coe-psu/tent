import { describe, expect, it } from 'vitest';
import {
	buildKioskContextQuery,
	getKioskDisplayContext,
	KIOSK_DISPLAY_QUERY_KEYS,
	readKioskDisplayQuery
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
				shelter_name: 'ศูนย์/หนึ่ง',
				shelter_code: 'SH001',
				station_name: 'จุด 1',
				device_name: 'Kiosk 1'
			})
		);

		expect([...query.keys()].sort()).toEqual([...KIOSK_DISPLAY_QUERY_KEYS].sort());
		expect(query.get('shelter_name')).toBe('ศูนย์/หนึ่ง');
		expect(query.get('shelter_code')).toBe('SH001');
		expect(query.get('phone_check_in')).toBeNull();
	});

	it('keeps fallback names out of the URL so the next screen can word them per language', () => {
		const contextQuery = buildKioskContextQuery(
			readKioskDisplayQuery(new URLSearchParams('shelter_code=SH001&station_name=%20%20'))
		);

		expect(contextQuery).toBe('?shelter_code=SH001');
		const next = readKioskDisplayQuery(new URLSearchParams(contextQuery));
		expect(getKioskDisplayContext(next, 'en').shelterName).toBe('Shelter');
		expect(getKioskDisplayContext(next, 'en').stationName).toBe('General screening point');
	});

	it('gives an empty query when there is no context', () => {
		expect(buildKioskContextQuery({})).toBe('');
	});

	it('reads only the allowlisted keys and ignores unknown parameters', () => {
		const query = readKioskDisplayQuery(
			new URLSearchParams(
				'shelter_code=SH001&phone_check_in=off&device_secret=hidden&error_msg=oops'
			)
		);

		expect(query).toEqual({
			shelter_name: null,
			shelter_code: 'SH001',
			station_name: null,
			device_name: null
		});
		expect(query).not.toHaveProperty('device_secret');
		expect(query).not.toHaveProperty('error_msg');
	});
});

describe('kiosk display context language', () => {
	it('falls back to English names when the language is English', () => {
		expect(getKioskDisplayContext({}, 'en')).toEqual({
			shelterName: 'Shelter',
			shelterCode: '',
			stationName: 'General screening point',
			deviceName: 'Kiosk'
		});
	});

	it('keeps real names untouched whatever the language', () => {
		expect(
			getKioskDisplayContext({ shelter_name: 'ศูนย์ A', station_name: 'S1' }, 'en')
		).toMatchObject({
			shelterName: 'ศูนย์ A',
			stationName: 'S1'
		});
	});
});
