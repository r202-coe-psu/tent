import { describe, expect, it } from 'vitest';
import { chunkLabels } from './chunk-labels';

const labels = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`);

describe('chunkLabels', () => {
	it('keeps up to 20 labels in one job', () => {
		expect(chunkLabels(labels(20), 20)).toEqual([labels(20)]);
	});

	it('splits 45 labels into 20 + 20 + 5, preserving order', () => {
		const chunks = chunkLabels(labels(45), 20);
		expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
		expect(chunks.flat()).toEqual(labels(45));
	});

	it('returns no jobs for no labels', () => {
		expect(chunkLabels([], 20)).toEqual([]);
	});

	it('rejects a chunk size below 1 instead of looping forever', () => {
		expect(() => chunkLabels(labels(3), 0)).toThrow(RangeError);
	});
});
