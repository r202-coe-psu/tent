import { describe, expect, it } from 'vitest';
import { formatUom, UOM_LABELS } from './uom';

describe('formatUom', () => {
	it('translates known English unit codes to Thai', () => {
		expect(formatUom('can')).toBe('กระป๋อง');
		expect(formatUom('piece')).toBe('ชิ้น');
		expect(formatUom('kg')).toBe('กิโลกรัม');
		expect(formatUom('kcal')).toBe('กิโลแคลอรี');
		expect(formatUom('litre')).toBe('ลิตร');
	});

	it('ignores case and surrounding spaces', () => {
		expect(formatUom('Bottle')).toBe('ขวด');
		expect(formatUom('  PCS ')).toBe('ชิ้น');
	});

	it('keeps Thai or unknown units unchanged', () => {
		expect(formatUom('ชิ้น')).toBe('ชิ้น');
		expect(formatUom('ถาด')).toBe('ถาด');
		expect(formatUom('foo')).toBe('foo');
	});

	it('returns an empty string for missing units', () => {
		expect(formatUom(undefined)).toBe('');
		expect(formatUom(null)).toBe('');
		expect(formatUom('   ')).toBe('');
	});

	it('uses lowercase keys only', () => {
		for (const key of Object.keys(UOM_LABELS)) expect(key).toBe(key.toLowerCase());
	});
});
