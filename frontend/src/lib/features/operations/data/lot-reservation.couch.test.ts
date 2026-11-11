import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ConflictError, NetworkError } from '$lib/utils/errors';

const putDocStrict = vi.hoisted(() => vi.fn());
vi.mock('$lib/db/couch-db', () => ({
	couchDbFetch: vi.fn(),
	findDocs: vi.fn(),
	getDocWithConflicts: vi.fn(),
	putDocStrict
}));

import { createSessionLotCounterConnector } from './lot-reservation.couch';

const doc = { _id: 'lot_counter:L-261102', last: 1 };

beforeEach(() => {
	putDocStrict.mockReset();
});

describe('session connector put', () => {
	it('reports a real HTTP 409 as a conflict', async () => {
		putDocStrict.mockRejectedValue(Object.assign(new ConflictError(), { httpStatus: 409 }));
		expect(await createSessionLotCounterConnector('shelter_sh001').put(doc)).toEqual({
			ok: false,
			conflict: true
		});
	});

	it.each([
		['a non-409 4xx that couch-db maps to ConflictError', new ConflictError('bad request')],
		['a network failure', new NetworkError()],
		['any other error', new AppError('boom', 'X')]
	])('throws on %s instead of retrying it as a conflict', async (_n, err) => {
		putDocStrict.mockRejectedValue(err);
		await expect(createSessionLotCounterConnector('shelter_sh001').put(doc)).rejects.toBe(err);
	});

	it('reports success', async () => {
		putDocStrict.mockResolvedValue(doc);
		expect(await createSessionLotCounterConnector('shelter_sh001').put(doc)).toEqual({ ok: true });
	});
});
