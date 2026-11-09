import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('$lib/db/repository', () => ({ createRemoteRepository: () => ({ get }) }));
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { evacueeQrDocId, readEvacueeQrPrints } from './evacuee-qr.remote';

const ID = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';

describe('readEvacueeQrPrints', () => {
	beforeEach(() => get.mockReset());

	it('maps evacuee id to evacuee_qr id', () => {
		expect(evacueeQrDocId(ID)).toBe('evacuee_qr:01JC8ZQ4V6M2N5R7T9XBDEFGH0');
	});

	it('returns [] for a missing doc', async () => {
		get.mockResolvedValue(null);
		expect(await readEvacueeQrPrints(ID)).toEqual([]);
		expect(get).toHaveBeenCalledWith('evacuee_qr:01JC8ZQ4V6M2N5R7T9XBDEFGH0');
	});

	it('returns stored printed_at/hash in order, skipping malformed entries', async () => {
		get.mockResolvedValue({
			prints: [
				{ printed_at: 'a', hash: 'AAAAAA', source: 'profile' },
				{ printed_at: 'b' },
				{ printed_at: 'c', hash: 'bbbbbb' }
			]
		});
		expect(await readEvacueeQrPrints(ID)).toEqual([
			{ printed_at: 'a', hash: 'aaaaaa' },
			{ printed_at: 'c', hash: 'bbbbbb' }
		]);
	});
});
