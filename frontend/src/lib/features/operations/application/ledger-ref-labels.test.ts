import { describe, expect, it, vi } from 'vitest';
import { digestRefIds, resolveLedgerRefLabels } from './ledger-ref-labels';

describe('digestRefIds', () => {
	it('stays short however many ids there are', () => {
		const ids = Array.from({ length: 5000 }, (_, i) => `donation:01M5KX8TQ4Q503Z0P2H1${i}`);
		expect(digestRefIds(ids).length).toBeLessThan(16);
	});

	it('is the same for the same ids and differs when an id changes', () => {
		expect(digestRefIds(['donation:1', 'donation:2'])).toBe(
			digestRefIds(['donation:1', 'donation:2'])
		);
		expect(digestRefIds(['donation:1', 'donation:2'])).not.toBe(
			digestRefIds(['donation:1', 'donation:3'])
		);
		expect(digestRefIds(['ab', 'c'])).not.toBe(digestRefIds(['a', 'bc']));
	});
});

describe('resolveLedgerRefLabels', () => {
	it('reads only the ids no cached result labelled', async () => {
		const read = vi.fn(async () => new Map([['donation:3', 'ผู้บริจาค ก']]));
		const cached = [new Map([['donation:1', 'ผู้บริจาค ข']]), undefined];

		const labels = await resolveLedgerRefLabels(
			['donation:1', 'donation:3', 'donation:4'],
			cached,
			read
		);

		expect(read).toHaveBeenCalledWith(['donation:3', 'donation:4']);
		expect([...labels]).toEqual([
			['donation:1', 'ผู้บริจาค ข'],
			['donation:3', 'ผู้บริจาค ก'],
			['donation:4', null]
		]);
	});

	it('reads an id again when it had no label last time', async () => {
		const read = vi.fn(async () => new Map([['donation:2', 'ผู้บริจาค ค']]));

		const labels = await resolveLedgerRefLabels(
			['donation:2'],
			[new Map([['donation:2', null]])],
			read
		);

		expect(read).toHaveBeenCalledWith(['donation:2']);
		expect(labels.get('donation:2')).toBe('ผู้บริจาค ค');
	});

	it('does not read when every id is labelled', async () => {
		const read = vi.fn(async () => new Map<string, string>());
		const labels = await resolveLedgerRefLabels(
			['donation:1'],
			[new Map([['donation:1', 'ผู้บริจาค ข']])],
			read
		);

		expect(read).not.toHaveBeenCalled();
		expect(labels.get('donation:1')).toBe('ผู้บริจาค ข');
	});
});
