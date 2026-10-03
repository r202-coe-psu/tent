import { describe, it, expect } from 'vitest';
import { getItemDisplayName } from './item-name';

describe('getItemDisplayName', () => {
	const itemMasters = [
		{ _id: 'item_master:rice', name: 'ข้าวสาร' },
		{ _id: 'item_master:egg', name: 'ไข่ไก่' }
	];
	const supplyItems = [
		{ _id: 'item:fish_sauce', name: 'น้ำปลา' },
		{ _id: 'item_master:egg', name: 'ไข่ไก่ (สต็อก)' }
	];

	it('returns item name from itemMasters when matched', () => {
		expect(getItemDisplayName('item_master:rice', itemMasters, supplyItems)).toBe('ข้าวสาร');
	});

	it('returns item name from supplyItems when not found in itemMasters', () => {
		expect(getItemDisplayName('item:fish_sauce', itemMasters, supplyItems)).toBe('น้ำปลา');
	});

	it('prioritizes itemMasters over supplyItems when ID exists in both', () => {
		expect(getItemDisplayName('item_master:egg', itemMasters, supplyItems)).toBe('ไข่ไก่');
	});

	it('falls back to raw ID when not found in either list', () => {
		expect(getItemDisplayName('item:unknown_id', itemMasters, supplyItems)).toBe('item:unknown_id');
	});

	it('handles null, undefined, or empty inputs gracefully', () => {
		expect(getItemDisplayName('', itemMasters, supplyItems)).toBe('');
		expect(getItemDisplayName(null, itemMasters, supplyItems)).toBe('');
		expect(getItemDisplayName('item_master:rice', null, null)).toBe('item_master:rice');
	});
});
