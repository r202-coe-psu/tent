import { describe, expect, it, vi } from 'vitest';
import { reviewInOrder } from './review-batch';
import type { JobApplication } from '../domain/job-application.schema';

const app = (id: string) => ({ _id: id }) as JobApplication;

describe('reviewInOrder', () => {
	it('reviews every application, one at a time, in the order given', async () => {
		const order: string[] = [];
		let running = 0;
		const review = vi.fn(async (application: JobApplication) => {
			running += 1;
			expect(running).toBe(1);
			order.push(application._id);
			await Promise.resolve();
			running -= 1;
		});

		const result = await reviewInOrder([app('a'), app('b'), app('c')], review);

		expect(order).toEqual(['a', 'b', 'c']);
		expect(result.done.map((a) => a._id)).toEqual(['a', 'b', 'c']);
		expect(result.failed).toEqual([]);
	});

	it('keeps going after a failure and reports it with its message', async () => {
		const review = vi.fn(async (application: JobApplication) => {
			if (application._id === 'b') throw new Error('กะนี้เต็มแล้ว');
		});

		const result = await reviewInOrder([app('a'), app('b'), app('c')], review);

		expect(result.done.map((a) => a._id)).toEqual(['a', 'c']);
		expect(result.failed).toEqual([{ application: app('b'), message: 'กะนี้เต็มแล้ว' }]);
	});
});
