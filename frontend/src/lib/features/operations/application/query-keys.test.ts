// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

let mockShelter = 'SH001';
vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => `shelter_${mockShelter.toLowerCase()}`,
	getShelterCode: () => mockShelter
}));

import { operationsKeys } from './queries';
import { supplyKeys } from '$lib/features/supply';

function keysFor(shelter: string) {
	mockShelter = shelter;
	return {
		ledger: operationsKeys.ledger(),
		byItem: operationsKeys.byItem('item:rice'),
		transfers: operationsKeys.transfers(),
		transfer: operationsKeys.transfer('t1'),
		filtered: operationsKeys.transfersFiltered({ status: 'shipped' } as never),
		overrides: supplyKeys.overrides()
	};
}

describe('per-shelter query keys carry the shelter code (#518)', () => {
	it('gives each shelter its own cache entry', () => {
		const a = keysFor('SH001');
		const b = keysFor('SH002');
		for (const name of Object.keys(a) as (keyof typeof a)[]) {
			expect(a[name]).toContain('SH001');
			expect(b[name]).toContain('SH002');
			expect(a[name]).not.toEqual(b[name]);
		}
		mockShelter = 'SH001';
	});

	it('keeps filtered transfers apart from the unfiltered list', () => {
		const k = keysFor('SH001');
		expect(k.filtered).not.toEqual(k.transfers);
		expect(k.filtered.slice(0, k.transfers.length)).toEqual([...k.transfers]);
	});
});
