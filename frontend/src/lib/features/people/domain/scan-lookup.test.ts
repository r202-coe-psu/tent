import { describe, expect, it } from 'vitest';
import {
	extractScanLookupToken,
	extractScanPersonQr,
	mongoUnassignedSearchQueries,
	pickUnassignedSearchHit,
	toCouchEvacueeId
} from './scan-lookup';

describe('extractScanLookupToken', () => {
	it('parses zoning / medical paths and bare tokens', () => {
		expect(extractScanLookupToken('/onsite/zoning/evacuee:ABC')).toBe('evacuee:ABC');
		expect(extractScanLookupToken('/onsite/medical-screening/evacuee:XYZ')).toBe('evacuee:XYZ');
		expect(extractScanLookupToken('evacuee:BARE')).toBe('evacuee:BARE');
		expect(extractScanLookupToken('01JABCDEFGHJKMNPQRSTVWXYZ0')).toBe('01JABCDEFGHJKMNPQRSTVWXYZ0');
	});

	const ULID = '01JC8ZQ4V6M2N5R7T9XBDEFGH0';

	it('strips @hash6 from a Person QR so the id never carries `@` (FR-EQR-6)', () => {
		expect(extractScanLookupToken(`evacuee:${ULID}@683508`)).toBe(`evacuee:${ULID}`);
		expect(extractScanLookupToken(`EVACUEE:${ULID.toLowerCase()}@68350A`)).toBe(`evacuee:${ULID}`);
	});

	it('treats a malformed @ suffix as not a Person QR (FR-EQR-5)', () => {
		expect(extractScanLookupToken(`evacuee:${ULID}@68350`)).toBeNull();
		expect(extractScanLookupToken(`evacuee:${ULID}@zzzzzz`)).toBeNull();
	});

	it('leaves bare ULID registration tickets unchanged (FR-EQR-31)', () => {
		expect(extractScanLookupToken(ULID)).toBe(ULID);
	});

	it('rejects bare station roots', () => {
		expect(extractScanLookupToken('/onsite/zoning')).toBeNull();
		expect(extractScanLookupToken('/onsite/medical-screening')).toBeNull();
	});
});

describe('toCouchEvacueeId', () => {
	it('adds or normalizes the evacuee: prefix', () => {
		expect(toCouchEvacueeId('01ABC')).toBe('evacuee:01ABC');
		expect(toCouchEvacueeId('evacuee:01ABC')).toBe('evacuee:01ABC');
		expect(toCouchEvacueeId('EVACUEE:01ABC')).toBe('evacuee:01ABC');
		expect(toCouchEvacueeId('  evacuee:01ABC  ')).toBe('evacuee:01ABC');
	});
});

describe('mongoUnassignedSearchQueries', () => {
	it('tries token and stripped evacuee: form', () => {
		expect(mongoUnassignedSearchQueries('reg-ulid-1')).toEqual(['reg-ulid-1']);
		expect(mongoUnassignedSearchQueries('evacuee:reg-ulid-1')).toEqual([
			'evacuee:reg-ulid-1',
			'reg-ulid-1'
		]);
	});
});

describe('pickUnassignedSearchHit', () => {
	it('prefers exact id match then first result', () => {
		const results = [{ id: 'a' }, { id: 'b' }];
		expect(pickUnassignedSearchHit(results, 'b')?.id).toBe('b');
		expect(pickUnassignedSearchHit(results, 'z')?.id).toBe('a');
		expect(pickUnassignedSearchHit([], 'a')).toBeNull();
	});
});

describe('extractScanPersonQr', () => {
	const ULID = '01JC8ZQ4V6M2N5R7T9XBDEFGH0';

	it('returns id + hash for Person QR, and null for tickets / other text', () => {
		expect(extractScanPersonQr(`evacuee:${ULID}@683508`)).toEqual({
			evacuee_id: `evacuee:${ULID}`,
			hash6: '683508'
		});
		expect(extractScanPersonQr(`evacuee:${ULID}`)).toEqual({
			evacuee_id: `evacuee:${ULID}`,
			hash6: null
		});
		expect(extractScanPersonQr(ULID)).toBeNull();
		// Handover-slip / path forms carrying an evacuee id are hash-less (legacy) Person QRs.
		for (const raw of [
			`/onsite/medical-screening/evacuee:${ULID}`,
			`https://x.test/onsite/zoning/evacuee:${ULID}`,
			`/onsite/people?evacuee_id=evacuee:${ULID}`
		]) {
			expect(extractScanPersonQr(raw)).toEqual({ evacuee_id: `evacuee:${ULID}`, hash6: null });
		}
		// A path with a bare ULID (registration ticket) stays exempt, as do non-ULID ids.
		expect(extractScanPersonQr(`/onsite/zoning/${ULID}`)).toBeNull();
		expect(extractScanPersonQr('/onsite/zoning/evacuee:ABC')).toBeNull();
	});
});
