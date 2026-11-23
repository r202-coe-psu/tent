// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import JobShiftAttention from './job-shift-attention.svelte';
import type { Job } from '../domain/job.schema';

let instance: ReturnType<typeof mount> | null = null;

const shift = (n: number, quota: number) => ({
	id: `s${n}`,
	date: `2026-12-${String((n % 28) + 1).padStart(2, '0')}`,
	end_date: `2026-12-${String((n % 28) + 1).padStart(2, '0')}`,
	start_time: '08:00',
	end_time: '12:00',
	quota
});

/** `shiftCount` shifts of 5 seats each; the projection fills them front to back from `confirmed`. */
const job = (shiftCount: number, confirmed: number) =>
	({
		_id: 'job:1',
		quota: shiftCount * 5,
		slots_confirmed: confirmed,
		slots_dispatched: 0,
		shifts: Array.from({ length: shiftCount }, (_, i) => shift(i, 5))
	}) as unknown as Job;

async function render(j: Job) {
	instance = mount(JobShiftAttention, { target: document.body, props: { job: j } });
	flushSync();
	await tick();
}
const rows = () => document.querySelectorAll('[data-testid="shift-attention-row"]');

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('JobShiftAttention (#1521)', () => {
	it.each([4, 35, 180])('keeps to three rows for a job with %i shifts', async (n) => {
		await render(job(n, 0));
		expect(rows().length).toBe(3);
		expect(document.body.textContent).toContain(`และอีก ${n - 3} กะ`);
	});

	it('lists the shift with nobody on it, even when it is the last by date', async () => {
		// 34 full shifts then one empty one: the empty shift (s34) must be shown.
		await render(job(35, 34 * 5));
		expect(rows()[0].textContent).toContain('ขาด 5');
		expect(rows()[0].getAttribute('data-shift-id')).toBe('s34');
	});

	it('says how the shifts split and keeps the whole-job total on one small line', async () => {
		// 5 shifts of 5 seats, 12 confirmed fill front to back: 5, 5, 2, 0, 0 → 2 met, 3 critical.
		await render(job(5, 12));
		const text = document.body.textContent ?? '';
		expect(text).toContain('5 กะ');
		expect(text).toContain('ขาดหนัก 3');
		expect(text).toContain('ครบ 2');
		expect(text).toContain('รวม 12/25');
	});

	it('does not say "and N more" when every shift fits', async () => {
		await render(job(2, 0));
		expect(rows().length).toBe(2);
		expect(document.body.textContent).not.toContain('และอีก');
	});
});
