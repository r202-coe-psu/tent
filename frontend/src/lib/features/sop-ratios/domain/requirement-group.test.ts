import { describe, it, expect } from 'vitest';
import {
	REQUIREMENT_GROUP_SCHEMA_VERSION,
	isShareSumOff,
	itemMapSchema,
	normalizeRequirementGroup,
	sumSharePercent,
	type RequirementGroup
} from './requirement-group';
import { DEFAULT_REQUIREMENT_GROUPS } from './requirement-group.fixture';

/** Builds share-only maps; numbers are passed through to cover legacy documents. */
function shareMaps(...shares: unknown[]) {
	return shares.map((share) => ({ share_percent: share as string | undefined }));
}

describe('sumSharePercent (#936)', () => {
	it('adds decimal strings exactly: 33.33 + 33.33 + 33.34 = 100', () => {
		expect(sumSharePercent(shareMaps('33.33', '33.33', '33.34'))).toBe('100');
	});

	it('adds 0.1 + 0.2 + 99.7 exactly to 100', () => {
		expect(sumSharePercent(shareMaps('0.1', '0.2', '99.7'))).toBe('100');
	});

	it('returns "0" for no maps', () => {
		expect(sumSharePercent([])).toBe('0');
	});

	it('counts a missing share as 0', () => {
		expect(sumSharePercent(shareMaps(undefined, '50'))).toBe('50');
	});

	it('accepts legacy numeric shares', () => {
		expect(sumSharePercent(shareMaps(50, 50))).toBe('100');
	});
});

describe('isShareSumOff (#936)', () => {
	it.each([
		{ name: 'exactly 100', shares: [100], off: false },
		{ name: '99.99 is within the 0.01 tolerance', shares: [99.99], off: false },
		{ name: '100.01 is within the 0.01 tolerance', shares: [100.01], off: false },
		{ name: '99.98 is outside the tolerance', shares: [99.98], off: true },
		{ name: '100.02 is outside the tolerance', shares: [100.02], off: true },
		{ name: 'no maps sums to 0 and is off', shares: [], off: true },
		{
			name: '33.33 x 3 = 99.99 is within tolerance',
			shares: ['33.33', '33.33', '33.33'],
			off: false
		}
	])('$name', ({ shares, off }) => {
		expect(isShareSumOff(shareMaps(...shares))).toBe(off);
	});
});

describe('itemMapSchema decimal fields (#936)', () => {
	const base = { item_id: 'item_master:egg', base_uom: 'piece', conversion_factor: 1 };

	it('stores a numeric conversion_factor as a qty string', () => {
		const parsed = itemMapSchema.parse({ ...base, conversion_factor: 6.3 });
		expect(parsed.conversion_factor).toBe('6.3');
	});

	it('keeps a string conversion_factor as is', () => {
		const parsed = itemMapSchema.parse({ ...base, conversion_factor: '17' });
		expect(parsed.conversion_factor).toBe('17');
	});

	it.each([0, '-1', 'abc'])('rejects conversion_factor %s', (conversion_factor) => {
		expect(itemMapSchema.safeParse({ ...base, conversion_factor }).success).toBe(false);
	});

	it.each([100, 0])('accepts share_percent %s', (share_percent) => {
		expect(itemMapSchema.safeParse({ ...base, share_percent }).success).toBe(true);
	});

	it('accepts a missing share_percent', () => {
		expect(itemMapSchema.safeParse(base).success).toBe(true);
	});

	it.each(['100.0001', -1])('rejects share_percent %s', (share_percent) => {
		expect(itemMapSchema.safeParse({ ...base, share_percent }).success).toBe(false);
	});
});

describe('REQUIREMENT_GROUP_SCHEMA_VERSION (#936)', () => {
	it('is 2', () => {
		expect(REQUIREMENT_GROUP_SCHEMA_VERSION).toBe(2);
	});
});

describe('itemMapSchema rounding and messages (#936)', () => {
	const base = { item_id: 'item_master:egg', base_uom: 'piece', conversion_factor: '1' };

	it('rejects conversion_factor 0.00001 with the Thai message', () => {
		const result = itemMapSchema.safeParse({ ...base, conversion_factor: '0.00001' });
		expect(result.success).toBe(false);
		expect(result.error?.issues.map((i) => i.message)).toContain(
			'ตัวคูณแปลงค่าต้องไม่น้อยกว่า 0.0001'
		);
	});

	it('accepts conversion_factor 0.0001', () => {
		expect(itemMapSchema.parse({ ...base, conversion_factor: '0.0001' }).conversion_factor).toBe(
			'0.0001'
		);
	});

	it('uses the Thai message for a share above 100', () => {
		const result = itemMapSchema.safeParse({ ...base, share_percent: '100.0001' });
		expect(result.error?.issues[0].message).toBe('ส่วนแบ่งต้องไม่เกิน 100');
	});

	it('uses the Thai message for a negative share', () => {
		const result = itemMapSchema.safeParse({ ...base, share_percent: '-1' });
		expect(result.error?.issues[0].message).toBe('ส่วนแบ่งต้องไม่ต่ำกว่า 0');
	});
});

describe('normalizeRequirementGroup (#936)', () => {
	const base = DEFAULT_REQUIREMENT_GROUPS[0];
	const legacy = (item_map: Record<string, unknown>, status?: 'active' | 'inactive') =>
		({
			...base,
			schema_v: 1,
			status,
			item_maps: [{ item_id: 'item_master:egg', base_uom: 'egg', ...item_map }]
		}) as unknown as RequirementGroup;

	it('rounds legacy numbers to four decimal places', () => {
		const out = normalizeRequirementGroup(
			legacy({ conversion_factor: 6.33333, share_percent: 33.33333 })
		);
		expect(out.item_maps?.[0]).toMatchObject({
			conversion_factor: '6.3333',
			share_percent: '33.3333'
		});
	});

	it.each([null, '', ' ', 'abc', 'NaN', 'Infinity', NaN, Infinity])(
		'rejects invalid share %s',
		(value) => {
			expect(() =>
				normalizeRequirementGroup(legacy({ conversion_factor: 1, share_percent: value }))
			).toThrow(/share_percent/);
		}
	);

	it.each([-1, 100.0001])('rejects out-of-range share %s', (value) => {
		expect(() =>
			normalizeRequirementGroup(legacy({ conversion_factor: 1, share_percent: value }))
		).toThrow(/share_percent/);
	});

	it('rejects a positive conversion factor that rounds to zero while preserving the legacy nonpositive fallback', () => {
		expect(() => normalizeRequirementGroup(legacy({ conversion_factor: 0.00001 }))).toThrow(
			/conversion_factor/
		);
		expect(
			normalizeRequirementGroup(legacy({ conversion_factor: 0 })).item_maps?.[0].conversion_factor
		).toBe('0');
	});

	it('validates range after rounding', () => {
		expect(
			normalizeRequirementGroup(legacy({ conversion_factor: 1, share_percent: 100.00004 }))
				.item_maps?.[0].share_percent
		).toBe('100');
	});

	it('leaves strings unchanged', () => {
		const out = normalizeRequirementGroup(
			legacy({ conversion_factor: '6.3', share_percent: '50' })
		);
		expect(out.item_maps?.[0]).toMatchObject({ conversion_factor: '6.3', share_percent: '50' });
	});

	it('keeps a missing share_percent missing', () => {
		const out = normalizeRequirementGroup(legacy({ conversion_factor: 2 }));
		expect(out.item_maps?.[0]).not.toHaveProperty('share_percent');
	});

	it('defaults a missing status to active, with or without item_maps', () => {
		expect(normalizeRequirementGroup(legacy({ conversion_factor: 1 })).status).toBe('active');
		const noMaps = { ...base, status: undefined, item_maps: undefined } as RequirementGroup;
		expect(normalizeRequirementGroup(noMaps).status).toBe('active');
		expect(normalizeRequirementGroup(legacy({ conversion_factor: 1 }, 'inactive')).status).toBe(
			'inactive'
		);
	});
});
