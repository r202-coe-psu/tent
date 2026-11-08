// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/svelte-query';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

import { emitDataChange } from '$lib/db/subscribe-data-changes';
import { operationsKeys, startOperationsLiveQuery } from './queries';

describe('startOperationsLiveQuery', () => {
	let handle: { stop: () => void } | undefined;
	afterEach(() => handle?.stop());

	it('invalidates lotReservations when a stock_lot_reservation doc changes', () => {
		const invalidateQueries = vi.fn();
		handle = startOperationsLiveQuery({ invalidateQueries } as unknown as QueryClient);
		emitDataChange('shelter_sh001', 'stock_lot_reservation', 'stock_lot_reservation:a');
		expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: operationsKeys.lotReservations() });
	});

	it('ignores changes from another shelter db', () => {
		const invalidateQueries = vi.fn();
		handle = startOperationsLiveQuery({ invalidateQueries } as unknown as QueryClient);
		emitDataChange('shelter_sh002', 'stock_lot_reservation', 'stock_lot_reservation:a');
		expect(invalidateQueries).not.toHaveBeenCalled();
	});
});
