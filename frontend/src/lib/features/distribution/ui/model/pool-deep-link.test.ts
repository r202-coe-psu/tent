import { describe, expect, it } from 'vitest';
import { missingDeepLinkedPoolId } from './pool-deep-link';

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
