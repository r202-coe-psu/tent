import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminRaw = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/couch-admin', () => ({ adminRaw }));

import { allocateLotNos } from './lot-number';

const ctx = { shelterCode: 'SH001', createdBy: 'bff' };
const when = new Date(2026, 10, 2);
const counterPath = '/shelter_sh001/lot_counter%3AL-261102';

beforeEach(() => {
	adminRaw.mockReset();
});

describe('allocateLotNos (BFF, CR-244)', () => {
	it('reads the counter with conflicts=true and bumps it with the read _rev', async () => {
		adminRaw.mockImplementation(async (path: string, method: string) => {
			if (method === 'GET') {
				expect(path).toBe(`${counterPath}?conflicts=true`);
				return {
					status: 200,
					data: { _id: 'lot_counter:L-261102', _rev: '1-a', type: 'lot_counter', last: 7 }
				};
			}
			return { status: 201, data: { ok: true } };
		});
		const nos = await allocateLotNos('shelter_sh001', 3, ctx, when);
		expect(nos).toEqual(['L-261102-008', 'L-261102-009', 'L-261102-010']);
		const put = adminRaw.mock.calls.find(([, m]) => m === 'PUT')!;
		expect(put[0]).toBe(counterPath);
		expect(put[2]).toMatchObject({ _rev: '1-a', last: 10 });
	});

	it('creates the counter from the ledger max when the day has none (no _rev)', async () => {
		adminRaw.mockImplementation(async (path: string, method: string) => {
			if (method === 'GET') return { status: 404, data: { error: 'not_found' } };
			if (path.endsWith('/_find'))
				return { status: 200, data: { docs: [{ lot: { lot_no: 'L-261102-004' } }] } };
			return { status: 201, data: { ok: true } };
		});
		expect(await allocateLotNos('shelter_sh001', 1, ctx, when)).toEqual(['L-261102-005']);
		const put = adminRaw.mock.calls.find(([, m]) => m === 'PUT')!;
		expect(put[2]._rev).toBeUndefined();
		expect(put[2]).toMatchObject({ type: 'lot_counter', last: 5 });
	});

	it('AC-3: a failed ledger lookup throws instead of restarting at 001', async () => {
		adminRaw.mockImplementation(async (path: string, method: string) => {
			if (method === 'GET') return { status: 404, data: null };
			if (path.endsWith('/_find')) return { status: 500, data: null };
			return { status: 201, data: { ok: true } };
		});
		await expect(allocateLotNos('shelter_sh001', 1, ctx, when)).rejects.toThrow(
			'ออกเลขล็อตไม่สำเร็จ'
		);
		expect(adminRaw.mock.calls.some(([, m]) => m === 'PUT')).toBe(false);
	});

	it('throws when CouchDB answers 5xx on the counter read', async () => {
		adminRaw.mockResolvedValue({ status: 503, data: null });
		await expect(allocateLotNos('shelter_sh001', 1, ctx, when)).rejects.toThrow();
	});
});
