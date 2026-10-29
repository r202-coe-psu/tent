// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import type { Volunteer } from '../domain/volunteer.schema';
import { SvelteDate } from 'svelte/reactivity';
import Harness from './minute-clock-harness.test-fixture.svelte';

// SvelteDate patches its getters from `Date.prototype` on first construction; do that with the
// real Date, before fake timers replace it.
new SvelteDate();

const MIN = 60_000;
const volunteers = new Map<string, Volunteer>([
	['volunteer:1', { _id: 'volunteer:1', first_name: 'ก', last_name: 'ข' } as Volunteer]
]);

function assignmentEndedAt(endMs: number): ShiftAssignment {
	return {
		_id: 'shift_assignment:1',
		job_id: 'job:A',
		shift_id: 'shift:1',
		volunteer_id: 'volunteer:1',
		date: '2026-08-10',
		shift: 'morning',
		status: 'assigned',
		duty_window: {
			start_ts: new Date(endMs - 8 * 60 * MIN).toISOString(),
			end_ts: new Date(endMs).toISOString()
		}
	} as ShiftAssignment;
}

let instance: ReturnType<typeof mount> | null = null;
const text = (id: string) => document.body.querySelector(`[data-testid="${id}"]`)?.textContent;

function render(assignments: ShiftAssignment[]) {
	instance = mount(Harness, { target: document.body, props: { assignments, volunteers } });
	flushSync();
}
function advance(ms: number) {
	vi.advanceTimersByTime(ms);
	flushSync();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('applicants tab minute clock', () => {
	it('AC-1: a shift that ended 29 min ago moves into "รอยืนยันการเข้างาน" within 2 minutes', () => {
		const start = new Date('2026-08-10T09:00:00.000Z');
		vi.setSystemTime(start);
		render([assignmentEndedAt(start.getTime() - 29 * MIN)]);
		expect(text('awaiting')).toBe('0');

		advance(2 * MIN);
		expect(text('awaiting')).toBe('1');
	});

	it('rolls today over at Bangkok midnight', () => {
		vi.setSystemTime(new Date('2026-08-10T16:59:00.000Z')); // 23:59 Bangkok
		render([]);
		expect(text('today')).toBe('2026-08-10');

		advance(MIN); // 00:00 Bangkok
		expect(text('today')).toBe('2026-08-11');
	});
});
