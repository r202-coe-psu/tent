import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskCardReadProgress from './kiosk-card-read-progress.svelte';

function html(props: { percent: number; stage: 'data' | 'photo' | 'saving' }): string {
	return render(KioskCardReadProgress, { props }).body;
}

describe('KioskCardReadProgress', () => {
	it('is a progress bar that announces the percent and what is being read', () => {
		const body = html({ percent: 42, stage: 'photo' });

		expect(body).toContain('role="progressbar"');
		expect(body).toContain('aria-valuemin="0"');
		expect(body).toContain('aria-valuemax="100"');
		expect(body).toContain('aria-valuenow="42"');
		expect(body).toContain('aria-valuetext="42% กำลังอ่านรูปถ่าย"');
		expect(body).toContain('data-testid="kiosk-register-card-busy"');
	});

	it('lists the three steps and marks each with text, not colour alone', () => {
		const body = html({ percent: 42, stage: 'photo' });

		for (const label of ['อ่านข้อมูลบัตร', 'อ่านรูปถ่าย', 'บันทึกข้อมูล']) {
			expect(body).toContain(label);
		}
		expect(body).toContain('เสร็จแล้ว');
		expect(body).toContain('กำลังดำเนินการ');
		expect(body).toContain('รอดำเนินการ');
		expect(body.match(/aria-current="step"/g)).toHaveLength(1);
	});

	it.each([
		['data', 0, 1, 2],
		['photo', 1, 1, 1],
		['saving', 2, 1, 0]
	] as const)('at %s: %i done, 1 current, the rest pending', (stage, done, current, pending) => {
		const body = html({ percent: 50, stage });

		expect(body.match(/เสร็จแล้ว/g)?.length ?? 0).toBe(done);
		expect(body.match(/กำลังดำเนินการ/g)?.length ?? 0).toBe(current);
		expect(body.match(/รอดำเนินการ/g)?.length ?? 0).toBe(pending);
	});

	it('keeps the percent within 0–100', () => {
		expect(html({ percent: 140, stage: 'saving' })).toContain('aria-valuenow="100"');
		expect(html({ percent: -5, stage: 'data' })).toContain('aria-valuenow="0"');
	});

	it('fills the ring in proportion to the percent', () => {
		const circumference = 2 * Math.PI * 54;
		const half = html({ percent: 50, stage: 'photo' });
		const done = html({ percent: 100, stage: 'saving' });

		expect(half).toContain(`stroke-dashoffset="${circumference * 0.5}"`);
		expect(done).toContain('stroke-dashoffset="0"');
	});

	it('does not animate for people who ask for reduced motion', () => {
		const body = html({ percent: 10, stage: 'data' });

		expect(body).toContain('motion-reduce:animate-none');
		expect(body).toContain('motion-reduce:transition-none');
	});

	it('scales up on the portrait kiosk', () => {
		expect(html({ percent: 10, stage: 'data' })).toContain('kiosk-portrait:size-64');
	});
});
