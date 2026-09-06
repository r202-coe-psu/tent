import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchShelterNeeds } from './public-needs';

/**
 * Source for the donor's "add an item" picker on the tracking page.
 *
 * A line the donor typed by hand carries no `item_id`, and such a line holds no quota
 * and is dropped at intake (`toCountedItems` keeps only catalog lines) — so the goods
 * could turn up with nothing to receive them against. The picker exists to keep the id
 * (and the shelter's own unit) on every added line.
 */
const board = [
	{
		code: 'SH001',
		name: 'ศูนย์ ก',
		needs: [
			{ item_id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', qty_needed: '108.0', status: 'open' },
			{ item_id: 'item:soap', name: 'สบู่ก้อน', unit: 'bar', qty_needed: '50.0', status: 'open' },
			{ item_id: 'item:full', name: 'ครบแล้ว', unit: 'piece', qty_needed: '0', status: 'closed' }
		]
	},
	{ code: 'SH002', name: 'ศูนย์ ข', needs: [{ item_id: 'item:egg', name: 'ไข่', unit: 'piece' }] }
];

function mockFetch(body: unknown, ok = true) {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response))
	);
}

describe('fetchShelterNeeds', () => {
	beforeEach(() => vi.restoreAllMocks());
	afterEach(() => vi.unstubAllGlobals());

	it('returns the open needs of the asked-for shelter only', async () => {
		mockFetch(board);

		const needs = await fetchShelterNeeds('SH001');

		expect(needs.map((n) => n.item_id)).toEqual(['item:rice', 'item:soap']);
		expect(needs[0]).toMatchObject({ name: 'ข้าวสาร', unit: 'kg' });
	});

	it('never offers a need the shelter has closed — it takes no more (T-22)', async () => {
		mockFetch(board);

		const needs = await fetchShelterNeeds('SH001');

		expect(needs.some((n) => n.item_id === 'item:full')).toBe(false);
	});

	it('matches the shelter code case-insensitively and trims it', async () => {
		mockFetch(board);

		expect((await fetchShelterNeeds(' sh002 ')).map((n) => n.item_id)).toEqual(['item:egg']);
	});

	it('returns nothing for an unknown shelter or a blank code, without calling the API', async () => {
		mockFetch(board);
		expect(await fetchShelterNeeds('SH999')).toEqual([]);

		const spy = vi.fn();
		vi.stubGlobal('fetch', spy);
		expect(await fetchShelterNeeds('   ')).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('drops rows with no item_id — the picker only offers catalog lines', async () => {
		mockFetch([{ code: 'SH001', needs: [{ name: 'ของเบ็ดเตล็ด', unit: 'ชิ้น', status: 'open' }] }]);

		expect(await fetchShelterNeeds('SH001')).toEqual([]);
	});

	it('raises when the board cannot be read, so the dialog can fall back', async () => {
		mockFetch({}, false);

		await expect(fetchShelterNeeds('SH001')).rejects.toThrow();
	});
});
