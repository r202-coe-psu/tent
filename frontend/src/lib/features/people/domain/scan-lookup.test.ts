import { describe, expect, it } from 'vitest';
import {
	extractScanLookupToken,
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
