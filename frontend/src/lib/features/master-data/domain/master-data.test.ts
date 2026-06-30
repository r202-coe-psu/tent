import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
	applyItemOp,
	createMasterData,
	enforceOneDefault,
	masterDataItemSchema,
	masterDataSchema,
	masterTypeSchema,
	slugifyLabel,
	touchMasterData,
	uniqueCode
} from './master-data';
import type { MasterDataItem } from './master-data';

const ctx = { createdBy: 'sa-user' };

function makeItem(partial: Partial<MasterDataItem> = {}): MasterDataItem {
	return { code: 'elderly', label: 'ผู้สูงอายุ', is_default: false, ...partial };
}

describe('masterTypeSchema', () => {
	it('accepts the 8 master types', () => {
		for (const t of [
			'vulnerable_group',
			'health_condition',
			'dietary_restrictions',
			'pet_types',
			'house_damage',
			'municipality_zone',
			'community',
			'shelter_type'
		] as const) {
			expect(masterTypeSchema.parse(t)).toBe(t);
		}
	});

	it('rejects unknown types', () => {
		expect(() => masterTypeSchema.parse('religion')).toThrow();
	});
});

describe('slugifyLabel', () => {
	it('uses the dict for known Thai labels', () => {
		expect(slugifyLabel('ผู้สูงอายุ')).toBe('elderly');
		expect(slugifyLabel('อิสลาม (Halal)')).toBe('halal');
		expect(slugifyLabel('สุนัข')).toBe('dog');
		expect(slugifyLabel('เสียหายทั้งหมด')).toBe('total_loss');
	});

	it('slugifies ASCII input', () => {
		expect(slugifyLabel('Chronic illness')).toBe('chronic_illness');
		expect(slugifyLabel('  Hal al  ')).toBe('hal_al');
	});

	it('falls back to item_<ulid> for non-ascii Thai without dict entry', () => {
		const code = slugifyLabel('สภาพอากาศหนาวมาก');
		expect(code).toMatch(/^item_[0-9a-z]{26}$/);
	});
});

describe('uniqueCode', () => {
	it('returns base when no collision', () => {
		expect(uniqueCode('ผู้สูงอายุ', [makeItem({ code: 'disabled' })])).toBe('elderly');
	});

	it('appends ULID on collision', () => {
		const code = uniqueCode('ผู้สูงอายุ', [makeItem()]);
		expect(code).toMatch(/^elderly_[0-9a-z]{26}$/);
	});
});

describe('enforceOneDefault', () => {
	it('keeps the only default untouched when no arg given', () => {
		const items = [makeItem({ is_default: true }), makeItem({ code: 'b' })];
		expect(enforceOneDefault(items)).toEqual(items);
	});

	it('unsets extra defaults defensively', () => {
		const items = [makeItem({ is_default: true }), makeItem({ code: 'b', is_default: true })];
		const out = enforceOneDefault(items);
		expect(out.filter((i) => i.is_default)).toHaveLength(1);
		expect(out[0].code).toBe('elderly');
	});

	it('switches default to the new code', () => {
		const items = [makeItem({ is_default: true }), makeItem({ code: 'b' })];
		const out = enforceOneDefault(items, 'b');
		expect(out.find((i) => i.code === 'b')?.is_default).toBe(true);
		expect(out.find((i) => i.code === 'elderly')?.is_default).toBe(false);
	});
});

describe('createMasterData', () => {
	it('stamps envelope, master_type, and id', () => {
		const doc = createMasterData('vulnerable_group', [makeItem()], ctx);
		expect(doc._id).toBe('master_data:vulnerable_group');
		expect(doc.type).toBe('master_data');
		expect(doc.schema_v).toBe(1);
		expect(doc.master_type).toBe('vulnerable_group');
		expect(doc.items).toHaveLength(1);
		expect(doc.created_by).toBe('sa-user');
		expect(doc.created_at).toBe(doc.updated_at);
	});

	it('passes masterDataSchema validation', () => {
		const doc = createMasterData(
			'pet_types',
			[makeItem({ code: 'dog', label: 'สุนัข' }), makeItem({ code: 'cat', label: 'แมว' })],
			ctx
		);
		expect(() => masterDataSchema.parse(doc)).not.toThrow();
	});
});

describe('touchMasterData', () => {
	beforeAll(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});
	afterAll(() => {
		vi.useRealTimers();
	});

	it('bumps updated_at to a fresh ISO timestamp', () => {
		const doc = createMasterData('pet_types', [makeItem()], ctx);
		const old = doc.updated_at;
		vi.advanceTimersByTime(100);
		const out = touchMasterData(doc);
		expect(out.updated_at).not.toBe(old);
		expect(typeof out.updated_at).toBe('string');
	});
});

describe('applyItemOp', () => {
	it('add generates a unique code', () => {
		const items = [makeItem()];
		const out = applyItemOp(items, { kind: 'add', label: 'ผู้พิการ' });
		expect(out).toHaveLength(2);
		expect(out[1].code).toBe('disabled');
	});

	it('add with is_default unsets previous default', () => {
		const items = [makeItem({ is_default: true })];
		const out = applyItemOp(items, {
			kind: 'add',
			label: 'ผู้พิการ',
			is_default: true
		});
		expect(out.find((i) => i.code === 'elderly')?.is_default).toBe(false);
		expect(out.find((i) => i.code === 'disabled')?.is_default).toBe(true);
	});

	it('edit updates label only', () => {
		const items = [makeItem()];
		const out = applyItemOp(items, { kind: 'edit', code: 'elderly', label: 'ผู้สูงอายุ (60+)' });
		expect(out[0].label).toBe('ผู้สูงอายุ (60+)');
		expect(out[0].code).toBe('elderly');
	});

	it('delete removes by code', () => {
		const items = [makeItem(), makeItem({ code: 'b' })];
		const out = applyItemOp(items, { kind: 'delete', code: 'elderly' });
		expect(out).toHaveLength(1);
		expect(out[0].code).toBe('b');
	});

	it('setDefault flips exactly one item to default', () => {
		const items = [makeItem({ is_default: true }), makeItem({ code: 'b' })];
		const out = applyItemOp(items, { kind: 'setDefault', code: 'b' });
		expect(out.find((i) => i.code === 'b')?.is_default).toBe(true);
		expect(out.find((i) => i.code === 'elderly')?.is_default).toBe(false);
	});
});

describe('parent_code (community type)', () => {
	it('masterDataItemSchema accepts item with parent_code', () => {
		const item = masterDataItemSchema.parse({
			code: 'c01',
			label: 'ชุมชนทดสอบ',
			is_default: false,
			parent_code: 'zone_1'
		});
		expect(item.parent_code).toBe('zone_1');
	});

	it('masterDataItemSchema accepts item without parent_code', () => {
		const item = masterDataItemSchema.parse({ code: 'z1', label: 'เขต 1', is_default: true });
		expect(item.parent_code).toBeUndefined();
	});

	it('createMasterData accepts shelter_type', () => {
		const doc = createMasterData(
			'shelter_type',
			[makeItem({ code: 'school', label: 'โรงเรียน', is_default: true })],
			ctx
		);
		expect(doc._id).toBe('master_data:shelter_type');
		expect(doc.master_type).toBe('shelter_type');
	});
});
