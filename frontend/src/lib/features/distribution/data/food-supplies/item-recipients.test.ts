import { describe, expect, it, vi } from 'vitest';

const allDocsByType = vi.fn();
vi.mock('$lib/db/couch-db', () => ({
	allDocsByType: (...args: unknown[]) => allDocsByType(...args)
}));
vi.mock('./shared', () => ({ resolveShelterDbName: (code: string) => `shelter_${code}` }));

import { listEvacueeRecipientsByItems } from './item-recipients';

const log = (over: Record<string, unknown>) => ({
	type: 'distribution_log',
	item_id: 'item_master:net',
	recipient_type: 'evacuee',
	recipient_id: 'evacuee:a',
	status: 'fulfilled',
	...over
});

describe('listEvacueeRecipientsByItems', () => {
	it('keeps one pair per evacuee and item, and drops voided and non-evacuee logs', async () => {
		allDocsByType.mockResolvedValueOnce([
			log({}),
			log({}),
			log({ recipient_id: 'evacuee:b', status: 'active' }),
			log({ recipient_id: 'evacuee:c', status: 'returned' }),
			log({ recipient_id: 'evacuee:d', status: 'voided' }),
			log({ recipient_type: 'staff', recipient_id: 'user:s' }),
			log({ recipient_type: 'outside', recipient_id: null }),
			log({ item_id: 'item_master:other' })
		]);
		const rows = await listEvacueeRecipientsByItems('sh001', ['item_master:net']);
		expect(rows.map((r) => r.recipient_id)).toEqual(['evacuee:a', 'evacuee:b', 'evacuee:c']);
		expect(allDocsByType.mock.calls[0][0]).toBe('shelter_sh001');
	});

	it('reads nothing when there are no items', async () => {
		allDocsByType.mockClear();
		expect(await listEvacueeRecipientsByItems('sh001', [])).toEqual([]);
		expect(allDocsByType).not.toHaveBeenCalled();
	});
});
