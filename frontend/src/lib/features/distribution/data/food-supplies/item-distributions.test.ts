import { describe, expect, it, vi } from 'vitest';

const allDocsByType = vi.fn();
vi.mock('$lib/db/couch-db', () => ({
	allDocsByType: (...args: unknown[]) => allDocsByType(...args)
}));
vi.mock('./shared', () => ({ resolveShelterDbName: (code: string) => `shelter_${code}` }));

import { listItemDistributions } from './item-distributions';

const log = (over: Record<string, unknown>) => ({
	type: 'distribution_log',
	item_id: 'item_master:net',
	recipient_type: 'evacuee',
	recipient_id: 'evacuee:a',
	status: 'fulfilled',
	qty: '1',
	...over
});

describe('listItemDistributions', () => {
	it('lists one row per non-voided log of the wanted items, with their quantities', async () => {
		allDocsByType.mockResolvedValueOnce([
			log({}),
			log({ recipient_id: 'evacuee:b', status: 'active', qty: '2', qty_returned: '1' }),
			log({ recipient_id: 'evacuee:c', status: 'returned' }),
			log({ recipient_id: 'evacuee:d', status: 'voided' }),
			log({ recipient_type: 'staff', recipient_id: 'user:s' }),
			log({ recipient_type: 'outside', recipient_id: null, qty: '5' }),
			log({ item_id: 'item_master:other' })
		]);
		const rows = await listItemDistributions('sh001', ['item_master:net']);
		expect(rows.map((r) => r.recipient_id)).toEqual([
			'evacuee:a',
			'evacuee:b',
			'evacuee:c',
			'user:s',
			null
		]);
		expect(rows[1]).toMatchObject({ qty: '2', qty_returned: '1' });
		expect(rows[0].qty_returned).toBe('0');
		expect(rows[4]).toMatchObject({ recipient_type: 'outside', qty: '5' });
		expect(allDocsByType.mock.calls[0][0]).toBe('shelter_sh001');
	});

	it('reads nothing when there are no items', async () => {
		allDocsByType.mockClear();
		expect(await listItemDistributions('sh001', [])).toEqual([]);
		expect(allDocsByType).not.toHaveBeenCalled();
	});
});
