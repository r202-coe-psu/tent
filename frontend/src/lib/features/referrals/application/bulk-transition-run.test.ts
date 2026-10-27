import { describe, expect, it, vi } from 'vitest';
import { chunk, runBulkTransition } from './bulk-transition-run';
import type { Referral } from '../domain/referral.schema';

const doc = (id: string) => ({ _id: id, status: 'closed' }) as unknown as Referral;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r:${i}`);

describe('chunk', () => {
	it('splits into consecutive chunks and keeps order', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 200)).toEqual([]);
	});
});

describe('runBulkTransition', () => {
	it('uses one request per 200 ids, sequentially', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const send = vi.fn(async (part: string[]) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await Promise.resolve();
			inFlight--;
			return { succeeded: part.map(doc), failed: [] };
		});
		const result = await runBulkTransition({ ids: ids(450), to: 'closed', send });
		expect(send).toHaveBeenCalledTimes(3);
		expect(maxInFlight).toBe(1);
		expect(result.succeeded).toHaveLength(450);
	});

	it('turns a failed request into per-id failures and keeps going', async () => {
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error('network down'))
			.mockImplementationOnce(async (part: string[]) => ({
				succeeded: part.map(doc),
				failed: []
			}));
		const onChunk = vi.fn();
		const result = await runBulkTransition({ ids: ids(250), to: 'closed', send, onChunk });
		expect(result.failed).toHaveLength(200);
		expect(result.failed[0]).toEqual({ id: 'r:0', error: 'network down' });
		expect(result.succeeded).toHaveLength(50);
		expect(onChunk).toHaveBeenCalledTimes(2);
	});

	it('passes target and reason through, and does nothing for no ids', async () => {
		const send = vi.fn(async (part: string[]) => ({ succeeded: part.map(doc), failed: [] }));
		await runBulkTransition({ ids: ['a'], to: 'rejected', reason: 'เต็ม', send });
		expect(send).toHaveBeenCalledWith(['a'], 'rejected', 'เต็ม');
		send.mockClear();
		await runBulkTransition({ ids: [], to: 'closed', send });
		expect(send).not.toHaveBeenCalled();
	});
});
