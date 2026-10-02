import { describe, it, expect } from 'vitest';
import { UlidReservation } from './ulid-reservation';

describe('UlidReservation', () => {
	it('mints distinct ULIDs on first use', () => {
		const ids = new UlidReservation();
		const a = ids.next();
		const b = ids.next();
		expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(a).not.toBe(b);
	});

	it('replays the same IDs in order after rewind', () => {
		const ids = new UlidReservation();
		const first = [ids.next(), ids.next()];
		ids.rewind();
		expect([ids.next(), ids.next()]).toEqual(first);
	});

	it('extends the pool when a retry needs more IDs than before', () => {
		const ids = new UlidReservation();
		const first = ids.next();
		ids.rewind();
		expect(ids.next()).toBe(first);
		expect(ids.next()).not.toBe(first);
	});
});
