// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

type QueryOptions = { queryKey: readonly unknown[]; enabled?: boolean };
const captured: { options?: () => QueryOptions } = {};

vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (options: () => QueryOptions) => {
		captured.options = options;
		return {};
	}
}));
vi.mock('./shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('./shared')>()),
	resolveShelterCode: (override?: string) => override ?? 'SH001'
}));
vi.mock('../../data/food-supplies/item-distributions', () => ({
	listItemDistributions: vi.fn()
}));

import { distributionKeys } from './keys';
import { useItemDistributions } from './read-queries';

describe('useItemDistributions query key', () => {
	it('is not under the logs prefix, so a distribution does not refetch every log', () => {
		useItemDistributions(['item_master:b', 'item_master:a'], true, 'SH001');
		const { queryKey } = captured.options!();
		const logsPrefix = [...distributionKeys.shelter('SH001'), 'logs'];
		expect(queryKey.slice(0, logsPrefix.length)).not.toEqual(logsPrefix);
		expect(queryKey.slice(0, -1)).toEqual([
			...distributionKeys.shelter('SH001'),
			'item-distributions'
		]);
		expect(queryKey.at(-1)).toBe('item_master:a,item_master:b');
	});
});
