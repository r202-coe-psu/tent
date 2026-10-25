import { describe, expect, it } from 'vitest';
import { nextClosedAt } from './closed-at';
import { updateShelterSchema } from './schema';

const NOW = '2026-10-25T03:00:00.000Z';
const STAMP = '2026-09-01T00:00:00.000Z';

describe('nextClosedAt', () => {
	it('stamps now when a shelter becomes closed with no closed_at', () => {
		expect(nextClosedAt('active', 'closed', null, NOW)).toBe(NOW);
		expect(nextClosedAt('active', 'closed', undefined, NOW)).toBe(NOW);
		expect(nextClosedAt('active', 'closed', '', NOW)).toBe(NOW);
	});

	it('keeps the existing stamp on later edits of a closed shelter', () => {
		expect(nextClosedAt('closed', 'closed', STAMP, NOW)).toBe(STAMP);
		expect(nextClosedAt('closed', undefined, STAMP, NOW)).toBe(STAMP);
	});

	it('leaves a legacy closed shelter unstamped on edits that do not close it', () => {
		expect(nextClosedAt('closed', undefined, null, NOW)).toBeNull();
		expect(nextClosedAt('closed', 'closed', null, NOW)).toBeNull();
	});

	it('clears closed_at when the shelter leaves closed', () => {
		expect(nextClosedAt('closed', 'active', STAMP, NOW)).toBeNull();
		expect(nextClosedAt('closed', 'standby', STAMP, NOW)).toBeNull();
		expect(nextClosedAt('closed', 'cancelled', STAMP, NOW)).toBeNull();
	});

	it('leaves an open shelter without closed_at', () => {
		expect(nextClosedAt('active', undefined, null, NOW)).toBeNull();
		expect(nextClosedAt('standby', 'active', null, NOW)).toBeNull();
	});

	it('restarts the clock when a reopened shelter is closed again', () => {
		const reopened = nextClosedAt('closed', 'active', STAMP, NOW);
		expect(nextClosedAt('active', 'closed', reopened, NOW)).toBe(NOW);
	});

	it('keeps whatever is stored when the status is unknown', () => {
		expect(nextClosedAt(null, undefined, STAMP, NOW)).toBe(STAMP);
		expect(nextClosedAt(null, undefined, null, NOW)).toBeNull();
	});
});

describe('updateShelterSchema closed_at', () => {
	it('does not default closed_at to null when the PATCH body omits it', () => {
		const parsed = updateShelterSchema.parse({ name: 'ศูนย์ใหม่' });
		expect('closed_at' in parsed).toBe(false);
	});
});
