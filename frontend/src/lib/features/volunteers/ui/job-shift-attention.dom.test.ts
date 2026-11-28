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
const pills = () =>
	Array.from(document.querySelectorAll('[data-testid="shift-bucket-pill"]')).map((e) =>
		(e.textContent ?? '').replace(/\s+/g, ' ').trim()
	);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('JobShiftAttention (#1521)', () => {
	it('lists no shift rows for a job of one shift', async () => {
		await render(job(1, 0));
		expect(document.querySelector('[data-testid="shift-attention-list"]')).toBeNull();
		expect(document.body.textContent).toContain('1 กะ');
		expect(document.body.textContent).toContain('0/5');
	});

	it.each([4, 35, 180])('lists every one of %i shifts in the scroll box', async (n) => {
		await render(job(n, 0));
		expect(document.querySelectorAll('[data-testid="shift-attention-row"]')).toHaveLength(n);
		expect(document.body.textContent).toContain(`${n} กะ`);
		expect(document.body.textContent).toContain(`0/${n * 5}`);
	});

	it('says what each shift lacks, emptiest first', async () => {
		// 5, 5, 2, 0, 0 confirmed → the two empty shifts lead, the two full ones trail.
		await render(job(5, 12));
		const rows = Array.from(document.querySelectorAll('[data-testid="shift-attention-row"]')).map(
			(e) => (e.textContent ?? '').replace(/\s+/g, ' ')
		);
		expect(rows.map((r) => r.match(/12:00\s*(\d+\/\d+(?: \(ขาด \d+\))?)/)?.[1])).toEqual([
			'0/5 (ขาด 5)',
			'0/5 (ขาด 5)',
			'2/5 (ขาด 3)',
			'5/5',
			'5/5'
		]);
	});

	it('says how the shifts split and keeps the whole-job total', async () => {
		// 5 shifts of 5 seats, 12 confirmed fill front to back: 5, 5, 2, 0, 0 → 2 met, 3 critical.
		await render(job(5, 12));
		expect(document.body.textContent).toContain('5 กะ');
		expect(pills()).toEqual(['ขาดหนัก 3', 'ครบ 2']);
		expect(document.body.textContent).toContain('12/25');
	});

	it('leaves out a bucket no shift is in', async () => {
		await render(job(2, 10));
		expect(pills()).toEqual(['ครบ 2']);
	});
});
