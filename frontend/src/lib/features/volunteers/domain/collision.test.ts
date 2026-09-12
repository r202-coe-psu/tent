import { describe, it, expect } from 'vitest';
import {
	windowsOverlap,
	hasTimeCollision,
	findTimeCollision,
	type CollisionCandidate
} from './collision';
import type { DutyWindow } from './shift-assignment.schema';

const morning: DutyWindow = {
	start_ts: '2026-08-26T08:00:00.000Z',
	end_ts: '2026-08-26T16:00:00.000Z'
};
const afternoon: DutyWindow = {
	start_ts: '2026-08-26T16:00:00.000Z',
	end_ts: '2026-08-27T00:00:00.000Z'
};
const overlapsAfternoon: DutyWindow = {
	start_ts: '2026-08-26T15:00:00.000Z',
	end_ts: '2026-08-26T18:00:00.000Z'
};

describe('windowsOverlap', () => {
	it('is true when intervals overlap', () => {
		expect(windowsOverlap(afternoon, overlapsAfternoon)).toBe(true);
	});

	it('is false when intervals only touch at the boundary (half-open)', () => {
		expect(windowsOverlap(morning, afternoon)).toBe(false);
	});

	it('is false for disjoint intervals', () => {
		expect(
			windowsOverlap(morning, {
				start_ts: '2026-08-27T08:00:00.000Z',
				end_ts: '2026-08-27T16:00:00.000Z'
			})
		).toBe(false);
	});
});

describe('hasTimeCollision', () => {
	it('is false for an empty existing-assignments list', () => {
		expect(hasTimeCollision(morning, [])).toBe(false);
	});

	it('is true when an active assignment overlaps the candidate window', () => {
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'assigned' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(true);
	});

	it('is false when the only overlapping assignment is cancelled', () => {
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'cancelled' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(false);
	});

	it('is false when the only overlapping assignment is no_show', () => {
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'no_show' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(false);
	});

	it('is true for a checked_in assignment that overlaps', () => {
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'checked_in' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(true);
	});

	it('is false when back-to-back shifts only touch at the boundary', () => {
		const existing: CollisionCandidate[] = [{ duty_window: morning, status: 'assigned' }];
		expect(hasTimeCollision(afternoon, existing)).toBe(false);
	});

	it('is true for a standby assignment that overlaps', () => {
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'standby' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(true);
	});

	it('is true for a completed assignment that overlaps (the shift already happened, still blocks a re-book)', () => {
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'completed' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(true);
	});

	it('is true when the candidate window is fully contained inside an existing blocking window', () => {
		const wide: DutyWindow = {
			start_ts: '2026-08-26T08:00:00.000Z',
			end_ts: '2026-08-26T20:00:00.000Z'
		};
		const containedCandidate: DutyWindow = {
			start_ts: '2026-08-26T10:00:00.000Z',
			end_ts: '2026-08-26T11:00:00.000Z'
		};
		const existing: CollisionCandidate[] = [{ duty_window: wide, status: 'assigned' }];
		expect(hasTimeCollision(containedCandidate, existing)).toBe(true);
	});

	it('finds a collision on the second entry even when the first does not overlap (no short-circuit false negative)', () => {
		const existing: CollisionCandidate[] = [
			{ duty_window: morning, status: 'assigned' }, // does not overlap `overlapsAfternoon`
			{ duty_window: afternoon, status: 'assigned' } // does
		];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(true);
	});

	it('treats an unparseable candidate window as a collision (fail closed, not open)', () => {
		const garbage: DutyWindow = { start_ts: 'not-a-date', end_ts: 'also-not-a-date' };
		const existing: CollisionCandidate[] = [{ duty_window: afternoon, status: 'assigned' }];
		expect(hasTimeCollision(garbage, existing)).toBe(true);
	});

	it('treats an unparseable existing window as a collision (fail closed, not open)', () => {
		const garbage: DutyWindow = { start_ts: 'not-a-date', end_ts: 'also-not-a-date' };
		const existing: CollisionCandidate[] = [{ duty_window: garbage, status: 'assigned' }];
		expect(hasTimeCollision(overlapsAfternoon, existing)).toBe(true);
	});
});

describe('windowsOverlap — garbage timestamps fail closed', () => {
	it('is true (not false) when a timestamp is unparseable', () => {
		const garbage: DutyWindow = { start_ts: 'nope', end_ts: 'nope' };
		expect(windowsOverlap(garbage, morning)).toBe(true);
		expect(windowsOverlap(morning, garbage)).toBe(true);
	});
});

describe('findTimeCollision', () => {
	it('returns the offending row itself, so the UI can name the clash', () => {
		const held = [
			{ duty_window: afternoon, status: 'standby' as const, label: 'พลาธิการ' },
			{ duty_window: morning, status: 'standby' as const, label: 'ครัวกลาง' }
		];
		expect(findTimeCollision(morning, held)?.label).toBe('ครัวกลาง');
	});

	it('returns undefined when the slot is clear, and agrees with hasTimeCollision', () => {
		const held: CollisionCandidate[] = [{ duty_window: afternoon, status: 'standby' }];
		expect(findTimeCollision(morning, held)).toBeUndefined();
		expect(hasTimeCollision(morning, held)).toBe(false);
	});

	it('skips released rows the same way hasTimeCollision does', () => {
		const held: CollisionCandidate[] = [
			{ duty_window: morning, status: 'cancelled' },
			{ duty_window: morning, status: 'no_show' }
		];
		expect(findTimeCollision(morning, held)).toBeUndefined();
	});
});
