import { describe, expect, it } from 'vitest';
import { decideDeepLinkedPool, missingDeepLinkedPoolId } from './pool-deep-link';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
	pool: { _id: id, ...extra }
});

describe('missingDeepLinkedPoolId', () => {
	const rows = [row('a'), row('b')];

	it('returns null while the data is not ready (loading, error or fetching)', () => {
		expect(missingDeepLinkedPoolId({ poolId: 'zzz', rows: [], dataReady: false })).toBeNull();
		expect(missingDeepLinkedPoolId({ poolId: 'zzz', rows, dataReady: false })).toBeNull();
	});

	it('returns null when the pool is in the rows', () => {
		expect(missingDeepLinkedPoolId({ poolId: 'a', rows, dataReady: true })).toBeNull();
	});

	it('returns null for pools that view filters would hide but the data holds', () => {
		const hidden = [
			row('old', { status: 'RECEIVED', received_at: '2000-01-01T00:00:00.000Z' }),
			row('gone', { status: 'CANCELLED' })
		];
		expect(missingDeepLinkedPoolId({ poolId: 'old', rows: hidden, dataReady: true })).toBeNull();
		expect(missingDeepLinkedPoolId({ poolId: 'gone', rows: hidden, dataReady: true })).toBeNull();
	});

	it('returns the id when the pool is not in the data', () => {
		expect(missingDeepLinkedPoolId({ poolId: 'missing', rows, dataReady: true })).toBe('missing');
		expect(missingDeepLinkedPoolId({ poolId: 'missing', rows: [], dataReady: true })).toBe(
			'missing'
		);
	});

	it('skips an id that was selected locally (just opened, not refetched yet)', () => {
		expect(
			missingDeepLinkedPoolId({
				poolId: 'new',
				rows,
				dataReady: true,
				locallySelectedId: 'new'
			})
		).toBeNull();
		expect(
			missingDeepLinkedPoolId({
				poolId: 'missing',
				rows,
				dataReady: true,
				locallySelectedId: 'new'
			})
		).toBe('missing');
	});

	it('returns null without a pool id', () => {
		expect(missingDeepLinkedPoolId({ poolId: null, rows, dataReady: true })).toBeNull();
		expect(missingDeepLinkedPoolId({ poolId: undefined, rows, dataReady: true })).toBeNull();
		expect(missingDeepLinkedPoolId({ poolId: '', rows, dataReady: true })).toBeNull();
	});
});

describe('decideDeepLinkedPool', () => {
	const rows = [row('a')];
	const base = {
		poolId: 'missing',
		rows,
		dataReady: true,
		dataUpdatedAt: 2000,
		linkArrivedAt: 1000,
		refetchRequested: false
	};

	it('is none while data is not ready, without a link id, or when the pool is present', () => {
		expect(decideDeepLinkedPool({ ...base, dataReady: false, dataUpdatedAt: 1 })).toBe('none');
		expect(decideDeepLinkedPool({ ...base, poolId: null })).toBe('none');
		expect(decideDeepLinkedPool({ ...base, poolId: 'a', dataUpdatedAt: 1 })).toBe('none');
	});

	it('is none for a local selection', () => {
		expect(decideDeepLinkedPool({ ...base, locallySelectedId: 'missing', dataUpdatedAt: 1 })).toBe(
			'none'
		);
	});

	it('asks for a refetch when the absent pool was checked against data older than the link', () => {
		expect(decideDeepLinkedPool({ ...base, dataUpdatedAt: 500 })).toBe('refetch');
		expect(decideDeepLinkedPool({ ...base, dataUpdatedAt: undefined })).toBe('refetch');
	});

	it('is missing when the data is as new as the link', () => {
		expect(decideDeepLinkedPool(base)).toBe('missing');
		expect(decideDeepLinkedPool({ ...base, dataUpdatedAt: 1000 })).toBe('missing');
	});

	it('never asks for a second refetch', () => {
		expect(decideDeepLinkedPool({ ...base, dataUpdatedAt: 500, refetchRequested: true })).toBe(
			'missing'
		);
	});

	it('is missing when no link arrival was recorded', () => {
		expect(decideDeepLinkedPool({ ...base, linkArrivedAt: null, dataUpdatedAt: 0 })).toBe(
			'missing'
		);
	});
});
