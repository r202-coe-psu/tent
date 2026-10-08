import { describe, expect, it, vi } from 'vitest';
import { createBusyReport } from './busy-report';

describe('createBusyReport', () => {
	it('reports only changes', () => {
		const onchange = vi.fn();
		const report = createBusyReport(onchange);

		report.update(false);
		report.update(true);
		report.update(true);
		report.update(false);

		expect(onchange.mock.calls).toEqual([[true], [false]]);
	});

	it('reports not-busy on release when it was busy, so the idle timeout never stays paused', () => {
		const onchange = vi.fn();
		const report = createBusyReport(onchange);

		report.update(true);
		report.release();

		expect(onchange.mock.calls).toEqual([[true], [false]]);
	});

	it('says nothing on release when it was not busy', () => {
		const onchange = vi.fn();
		createBusyReport(onchange).release();

		expect(onchange).not.toHaveBeenCalled();
	});
});
