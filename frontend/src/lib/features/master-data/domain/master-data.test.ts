import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
	applyItemOp,
	createMasterData,
	enforceOneDefault,
	findDuplicateLabel,
	findLabelCollision,
	normalizeLabel,
	masterDataItemSchema,
	masterDataSchema,
	masterTypeSchema,
	migrateMasterDataToV3,
	needsMasterDataMigration,
	touchMasterData
} from './master-data';
import type { MasterDataItem } from './master-data';

const ctx = { createdBy: 'sa-user' };

function makeItem(partial: Partial<MasterDataItem> = {}): MasterDataItem {
	return { code: 'elderly', label: 'ผู้สูงอายุ', is_default: false, status: 'active', ...partial };
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

describe('unique label (CR-078)', () => {
	describe('normalizeLabel', () => {
		it('trims, collapses inner whitespace, and lowercases the Latin part', () => {
			expect(normalizeLabel('  ผู้สูงอายุ   (Elderly)  ')).toBe('ผู้สูงอายุ (elderly)');
		});

		it('treats a non-breaking space like a normal space', () => {
			expect(normalizeLabel('ผู้\u00A0พิการ')).toBe(normalizeLabel('ผู้ พิการ'));
		});
	});

	describe('findDuplicateLabel', () => {
		const items = [
			makeItem({ code: 'a', label: 'ผู้สูงอายุ' }),
			makeItem({ code: 'b', label: 'ผู้พิการ', status: 'inactive' })
		];

		it('finds a collision that differs only by surrounding whitespace', () => {
			expect(findDuplicateLabel(items, '  ผู้สูงอายุ ')?.code).toBe('a');
		});

		it('counts an inactive item as taken', () => {
			expect(findDuplicateLabel(items, 'ผู้พิการ')?.code).toBe('b');
		});

		it('returns undefined for a genuinely new label', () => {
			expect(findDuplicateLabel(items, 'สตรีมีครรภ์')).toBeUndefined();
		});

		it('excludes the item being edited so a re-save without rename passes', () => {
			expect(findDuplicateLabel(items, 'ผู้สูงอายุ', 'a')).toBeUndefined();
		});

		it('still blocks renaming one item onto another item label', () => {
			expect(findDuplicateLabel(items, 'ผู้พิการ', 'a')?.code).toBe('b');
		});

		it('returns undefined for a blank label (the required-field rule owns that)', () => {
			expect(findDuplicateLabel(items, '   ')).toBeUndefined();
		});
	});

	describe('findLabelCollision', () => {
		it('detects a duplicate inside the submitted list', () => {
			const dup = findLabelCollision([
				makeItem({ code: 'a', label: 'สุนัข' }),
				makeItem({ code: 'b', label: ' สุนัข ' })
			]);
			expect(dup).toBe(' สุนัข ');
		});

		it('detects a shelter-local item colliding with a global one', () => {
			const local = [makeItem({ code: 'local', label: 'แมว' })];
			const global = [makeItem({ code: 'global', label: 'แมว' })];
			expect(findLabelCollision(local, global)).toBe('แมว');
		});

		it('returns undefined when the list and the global tier are both clean', () => {
			const local = [makeItem({ code: 'local', label: 'กระต่าย' })];
			const global = [makeItem({ code: 'global', label: 'แมว' })];
			expect(findLabelCollision(local, global)).toBeUndefined();
		});

		it('returns undefined for an empty list', () => {
			expect(findLabelCollision([])).toBeUndefined();
		});
	});
});

describe('createMasterData', () => {
	it('stamps envelope, master_type, and id', () => {
		const doc = createMasterData('vulnerable_group', [makeItem()], ctx);
		expect(doc._id).toBe('master_data:vulnerable_group');
		expect(doc.type).toBe('master_data');
		expect(doc.schema_v).toBe(3);
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
		expect(out[1].code).toMatch(/^item_[0-9a-z]{26}$/);
		expect(out[1].status).toBe('active');
	});

	it('add with is_default unsets previous default', () => {
		const items = [makeItem({ is_default: true })];
		const out = applyItemOp(items, {
			kind: 'add',
			label: 'ผู้พิการ',
			is_default: true
		});
		expect(out[0].is_default).toBe(false);
		expect(out[1].is_default).toBe(true);
	});

	it('edit updates label only', () => {
		const items = [makeItem()];
		const out = applyItemOp(items, { kind: 'edit', code: 'elderly', label: 'ผู้สูงอายุ (60+)' });
		expect(out[0].label).toBe('ผู้สูงอายุ (60+)');
		expect(out[0].code).toBe('elderly');
	});

	it('setDefault flips exactly one item to default', () => {
		const items = [makeItem({ is_default: true }), makeItem({ code: 'b' })];
		const out = applyItemOp(items, { kind: 'setDefault', code: 'b' });
		expect(out.find((i) => i.code === 'b')?.is_default).toBe(true);
		expect(out.find((i) => i.code === 'elderly')?.is_default).toBe(false);
	});

	it('setStatus sets only the matching item to inactive', () => {
		const items = [makeItem(), makeItem({ code: 'b' })];
		const out = applyItemOp(items, { kind: 'setStatus', code: 'elderly', status: 'inactive' });
		expect(out.find((i) => i.code === 'elderly')?.status).toBe('inactive');
		expect(out.find((i) => i.code === 'b')?.status).toBe('active');
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

	it('creates a shelter-local document when a shelter code is supplied', () => {
		const doc = createMasterData(
			'shelter_type',
			[makeItem({ code: 'school', label: 'โรงเรียน', is_default: true })],
			ctx,
			'SH001'
		);
		expect(doc._id).toBe('master_data:shelter_type:SH001');
		expect(doc.schema_v).toBe(3);
		expect(doc.shelter_code).toBe('SH001');
	});
});

describe('masterDataItemSchema status default', () => {
	it('defaults status to active when omitted', () => {
		const item = masterDataItemSchema.parse({ code: 'z1', label: 'เขต 1', is_default: true });
		expect(item.status).toBe('active');
	});
});

describe('needsMasterDataMigration', () => {
	const v3Doc = {
		_id: 'master_data:pet_types',
		type: 'master_data' as const,
		schema_v: 3,
		master_type: 'pet_types' as const,
		items: [{ code: 'dog', label: 'Dog', is_default: true, status: 'active' as const }],
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		created_by: 'seed'
	};

	it('is false for a clean v3 doc', () => {
		expect(needsMasterDataMigration(v3Doc)).toBe(false);
	});

	it('is true when schema_v < 3', () => {
		expect(needsMasterDataMigration({ ...v3Doc, schema_v: 2 })).toBe(true);
	});

	it('is true when excluded_codes is still present', () => {
		expect(needsMasterDataMigration({ ...v3Doc, excluded_codes: ['dog'] })).toBe(true);
	});

	it('is true when any item is missing status', () => {
		expect(
			needsMasterDataMigration({
				...v3Doc,
				items: [{ code: 'dog', label: 'Dog', is_default: true }]
			})
		).toBe(true);
	});
});

describe('migrateMasterDataToV3', () => {
	it('backfills status, drops excluded_codes, and stamps schema_v 3', () => {
		const legacy = {
			_id: 'master_data:pet_types:SH001',
			type: 'master_data' as const,
			schema_v: 2,
			master_type: 'pet_types' as const,
			shelter_code: 'SH001',
			items: [
				{ code: 'dog', label: 'Dog', is_default: true },
				{ code: 'cat', label: 'Cat', is_default: false, status: 'inactive' as const }
			],
			excluded_codes: ['bird'],
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			created_by: 'seed'
		};
		const v3 = migrateMasterDataToV3(legacy);
		expect(v3.schema_v).toBe(3);
		expect(v3.items[0].status).toBe('active'); // backfilled
		expect(v3.items[1].status).toBe('inactive'); // preserved
		expect((v3 as { excluded_codes?: string[] }).excluded_codes).toBeUndefined();
		expect(v3.shelter_code).toBe('SH001'); // envelope preserved
	});

	it('is idempotent — a v3 doc round-trips unchanged (except identity)', () => {
		const v3 = {
			_id: 'master_data:pet_types',
			type: 'master_data' as const,
			schema_v: 3,
			master_type: 'pet_types' as const,
			items: [{ code: 'dog', label: 'Dog', is_default: true, status: 'active' as const }],
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			created_by: 'seed'
		};
		expect(migrateMasterDataToV3(v3)).toEqual(v3);
	});
});
