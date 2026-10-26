import { describe, it, expect, vi, beforeEach } from 'vitest';

const toastWarning = vi.fn();
vi.mock('svelte-sonner', () => ({
	toast: { warning: (...args: unknown[]) => toastWarning(...args) }
}));

const recordStationStart = vi.fn();
vi.mock('../data/people.remote', () => ({
	peopleRepository: () => ({ recordStationStart })
}));

import { startStaffStationVisit, withStationLogWarning } from './station-log';
import { STATION_LOG_WRITE_WARNING } from '../domain/station-log';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

describe('withStationLogWarning', () => {
	beforeEach(() => {
		toastWarning.mockReset();
	});

	it('returns the write result and stays silent when the log write succeeds', async () => {
		const result = await withStationLogWarning(async () => 'saved');
		expect(result).toBe('saved');
		expect(toastWarning).not.toHaveBeenCalled();
	});

	it('shows one warning toast when the write reports a log failure, keeping the result', async () => {
		const result = await withStationLogWarning(async (opts) => {
			opts.onStationLogError?.(new Error('log failed'));
			return 'saved';
		});
		expect(result).toBe('saved');
		expect(toastWarning).toHaveBeenCalledTimes(1);
		expect(toastWarning).toHaveBeenCalledWith(STATION_LOG_WRITE_WARNING, expect.any(Object));
	});

	it('passes startedAt through and does not swallow a failure of the write itself', async () => {
		let seen: string | undefined;
		await expect(
			withStationLogWarning(
				async (opts) => {
					seen = opts.startedAt;
					throw new Error('save failed');
				},
				{ startedAt: '2026-10-25T03:00:00.000Z' }
			)
		).rejects.toThrow('save failed');
		expect(seen).toBe('2026-10-25T03:00:00.000Z');
		expect(toastWarning).not.toHaveBeenCalled();
	});
});

describe('startStaffStationVisit', () => {
	beforeEach(() => {
		toastWarning.mockReset();
		recordStationStart.mockReset();
	});

	it('records a start for the evacuee and station', async () => {
		recordStationStart.mockResolvedValue(true);
		await startStaffStationVisit('evacuee:1', 3, ctx);
		expect(recordStationStart).toHaveBeenCalledWith('evacuee:1', 3, ctx);
		expect(toastWarning).not.toHaveBeenCalled();
	});

	it('never throws and warns when the start cannot be written', async () => {
		recordStationStart.mockRejectedValue(new Error('Failed to fetch'));
		await expect(startStaffStationVisit('evacuee:1', 2, ctx)).resolves.toBeUndefined();
		expect(toastWarning).toHaveBeenCalledWith(STATION_LOG_WRITE_WARNING, expect.any(Object));
	});

	it('ignores a call without an evacuee id', async () => {
		await startStaffStationVisit('', 2, ctx);
		expect(recordStationStart).not.toHaveBeenCalled();
	});
});
