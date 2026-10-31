import { describe, expect, it } from 'vitest';
import { parseVolunteerScanCode } from './scan-code';

describe('parseVolunteerScanCode', () => {
	it('reads a role-card token from the digital-pass URL the QR encodes', () => {
		expect(
			parseVolunteerScanCode('https://shelter.example/volunteer/ticket/TKT-VOL-KPZSA5TDGTB9S3YD')
		).toEqual({ kind: 'token', token: 'TKT-VOL-KPZSA5TDGTB9S3YD' });
	});

	it('reads a bare token and a hash payload, in any case', () => {
		expect(parseVolunteerScanCode('tkt-vol-abc123')).toEqual({
			kind: 'token',
			token: 'tkt-vol-abc123'
		});
		expect(parseVolunteerScanCode(`TKT-VOL-HASH-${'A'.repeat(64)}`)).toEqual({
			kind: 'token',
			token: `TKT-VOL-HASH-${'A'.repeat(64)}`
		});
	});

	it('reads a volunteer doc id with a normalized prefix', () => {
		expect(parseVolunteerScanCode('Volunteer:01HZXVOL')).toEqual({
			kind: 'id',
			id: 'volunteer:01HZXVOL'
		});
		expect(parseVolunteerScanCode('volunteer:')).toBeNull();
	});

	it('reads a printed volunteer code, uppercased', () => {
		expect(parseVolunteerScanCode(' v-007 ')).toEqual({ kind: 'code', code: 'V-007' });
	});

	it('rejects evacuee cards, phone numbers and blanks', () => {
		expect(parseVolunteerScanCode('evacuee:01HZXEVAC')).toBeNull();
		expect(parseVolunteerScanCode('https://shelter.example/zoning/evacuee:01HZXEVAC')).toBeNull();
		expect(parseVolunteerScanCode('01HZXEVAC')).toBeNull();
		expect(parseVolunteerScanCode('0812345678')).toBeNull();
		expect(parseVolunteerScanCode('   ')).toBeNull();
	});

	it('leaves staff card payloads to the staff lookup', () => {
		expect(parseVolunteerScanCode(`TKT-STF-HASH-${'a'.repeat(64)}`)).toBeNull();
		expect(parseVolunteerScanCode(`tkt-stf-hash-${'a'.repeat(64)}`)).toBeNull();
	});
});
