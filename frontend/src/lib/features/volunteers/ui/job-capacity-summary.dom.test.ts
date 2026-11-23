// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import JobCapacitySummary from './job-capacity-summary.svelte';
import type { Job } from '../domain/job.schema';

let instance: ReturnType<typeof mount> | null = null;

const job = (id: string, status: string, shiftCount: number) =>
	({
		_id: id,
		status,
		quota: shiftCount * 5,
		slots_confirmed: 0,
		slots_dispatched: 0,
		shifts: Array.from({ length: shiftCount }, (_, i) => ({
			id: `${id}-s${i}`,
			date: '2026-12-01',
			end_date: '2026-12-01',
			start_time: '08:00',
			end_time: '12:00',
			quota: 5
		}))
	}) as unknown as Job;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('JobCapacitySummary (#1521)', () => {
	it('says its unit is the shift and how many jobs and shifts it counted', async () => {
		instance = mount(JobCapacitySummary, {
			target: document.body,
			props: {
				jobs: [job('j1', 'open', 3), job('j2', 'full', 2), job('j3', 'paused', 4)],
				onselect: () => {}
			}
		});
		flushSync();
		await tick();

		// the paused job is not tracked: 2 jobs, 5 shifts
		expect(document.querySelector('[data-testid="capacity-scope"]')?.textContent).toContain(
			'2 งาน (5 กะ)'
		);
		const text = document.body.textContent ?? '';
		for (const label of ['กะขาดแคลนหนัก', 'กะใกล้ครบเป้า', 'กะครบตามเป้า', 'อัตราจองรวมทุกกะ']) {
			expect(text, label).toContain(label);
		}
	});
});
