import { describe, expect, it } from 'vitest';
import { transferItemLabel, transferItemNames } from './transfer-item-label';

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

describe('transferItemNames', () => {
	it('keeps deactivated and merged masters so old transfers still resolve', () => {
		const masters = [
			{ _id: 'item_master:A', name: 'ข้าวสาร', deactivated: true },
			{ _id: 'item_master:B', name: 'ข้าวหอม', merged_into: 'item_master:C' }
		];
		const names = transferItemNames([{ _id: 'supply:1', name: 'น้ำดื่ม' }], masters);
		expect(transferItemLabel(line('item_master:A'), names).name).toBe('ข้าวสาร');
		expect(transferItemLabel(line('item_master:B'), names).name).toBe('ข้าวหอม');
		expect(names.get('supply:1')).toBe('น้ำดื่ม');
	});
});
