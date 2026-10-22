import { describe, expect, it } from 'vitest';
import { transferItemLabel } from './transfer-item-label';

const names = new Map([['item_master:A', 'ข้าวสาร 1 กิโลกรัม']]);
const line = (item_id: string) => ({ item_id, qty: 3, unit: 'kg' });

describe('transferItemLabel', () => {
	it('uses the catalog name when known', () => {
		expect(transferItemLabel(line('item_master:A'), names).text).toBe('ข้าวสาร 1 กิโลกรัม 3 kg');
	});

	it('falls back to the raw item id when unknown', () => {
		expect(transferItemLabel(line('item_master:Z'), names).name).toBe('item_master:Z');
	});

	it('formats the unit and falls back to the raw unit when empty', () => {
		expect(transferItemLabel(line('item_master:A'), names, () => 'กก.').unit).toBe('กก.');
		expect(transferItemLabel(line('item_master:A'), names, () => '').unit).toBe('kg');
	});
});
