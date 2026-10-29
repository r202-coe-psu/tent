import { describe, expect, it } from 'vitest';
import {
	formatStaffToken,
	isValidStaffTokenHash,
	parseStaffCardPayload,
	staffCardPayloadFromHash,
	staffRecipientId,
	userNameFromStaffRecipientId
} from './staff-card';

describe('formatStaffToken', () => {
	it('renders 16 bytes as the TKT-STF- prefix plus 32 uppercase hex digits', () => {
		const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
		expect(formatStaffToken(bytes)).toBe('TKT-STF-000102030405060708090A0B0C0D0E0F');
	});

	it('rejects a byte array that is not exactly 16 bytes', () => {
		expect(() => formatStaffToken(new Uint8Array(15))).toThrow(RangeError);
		expect(() => formatStaffToken(new Uint8Array(17))).toThrow(RangeError);
	});
});

describe('isValidStaffTokenHash', () => {
	it('accepts exactly 64 lowercase hex digits', () => {
		expect(isValidStaffTokenHash('0123456789abcdef'.repeat(4))).toBe(true);
	});

	it('rejects uppercase, wrong length, non-hex and non-strings', () => {
		expect(isValidStaffTokenHash('0123456789ABCDEF'.repeat(4))).toBe(false);
		expect(isValidStaffTokenHash('a'.repeat(63))).toBe(false);
		expect(isValidStaffTokenHash('a'.repeat(65))).toBe(false);
		expect(isValidStaffTokenHash('g'.repeat(64))).toBe(false);
		expect(isValidStaffTokenHash(`${'a'.repeat(64)}\n`)).toBe(false);
		expect(isValidStaffTokenHash(undefined)).toBe(false);
		expect(isValidStaffTokenHash(42)).toBe(false);
	});
});

const HASH = '0123456789abcdef'.repeat(4);

describe('parseStaffCardPayload', () => {
	it('reads the hash from a bare staff card payload', () => {
		expect(parseStaffCardPayload(`TKT-STF-HASH-${HASH}`)).toEqual({ hash: HASH });
	});

	it('reads the hash from a payload inside a URL path', () => {
		expect(
			parseStaffCardPayload(`https://shelter.example/distribution/TKT-STF-HASH-${HASH}`)
		).toEqual({
			hash: HASH
		});
	});

	it('lowercases an uppercase prefix and hash', () => {
		expect(parseStaffCardPayload(`tkt-stf-hash-${HASH.toUpperCase()}`)).toEqual({ hash: HASH });
		expect(parseStaffCardPayload(`  Tkt-Stf-Hash-${HASH.toUpperCase()}  `)).toEqual({ hash: HASH });
	});

	it('rejects garbage, short hashes, blanks, volunteer payloads and plaintext staff tokens', () => {
		expect(parseStaffCardPayload('hello')).toBeNull();
		expect(parseStaffCardPayload('   ')).toBeNull();
		expect(parseStaffCardPayload('TKT-STF-HASH-abc123')).toBeNull();
		expect(parseStaffCardPayload(`TKT-STF-HASH-${'g'.repeat(64)}`)).toBeNull();
		expect(parseStaffCardPayload(`TKT-VOL-HASH-${HASH}`)).toBeNull();
		expect(parseStaffCardPayload('evacuee:01HZXEVAC')).toBeNull();
		expect(parseStaffCardPayload('TKT-STF-000102030405060708090A0B0C0D0E0F')).toBeNull();
	});
});

describe('staffCardPayloadFromHash', () => {
	it('prefixes the hash with TKT-STF-HASH- and parses back to the same hash', () => {
		const payload = staffCardPayloadFromHash(HASH);
		expect(payload).toBe(`TKT-STF-HASH-${HASH}`);
		expect(parseStaffCardPayload(payload)).toEqual({ hash: HASH });
	});
});

describe('staffRecipientId', () => {
	it('prefixes the CouchDB user name with user: and maps back to it', () => {
		expect(staffRecipientId('somchai')).toBe('user:somchai');
		expect(userNameFromStaffRecipientId('user:somchai')).toBe('somchai');
	});

	it('rejects ids that are not user: recipients or have an empty name', () => {
		expect(userNameFromStaffRecipientId('volunteer:01HZXVOL')).toBeNull();
		expect(userNameFromStaffRecipientId('evacuee:01HZXEVAC')).toBeNull();
		expect(userNameFromStaffRecipientId('somchai')).toBeNull();
		expect(userNameFromStaffRecipientId('user:')).toBeNull();
	});
});
