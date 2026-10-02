import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
	applyItemOp,
	createMasterData,
	CR112_VULNERABLE_GROUP_ACTIVE,
	enforceOneDefault,
	dedupeItemsByCode,
	duplicateItemCodes,
	duplicateLabelKeys,
	findDuplicateLabel,
	findLabelCollision,
	formatMasterLabel,
	formatMasterLabelByCode,
	isLegacyItemCode,
	MASTER_DATA_TYPES,
	MASTER_DATA_TYPE_META,
	normalizeLabel,
	normalizeMasterCode,
	masterDataItemSchema,
	masterDataSchema,
	masterTypeSchema,
	migrateMasterDataToV4,
	needsMasterDataMigration,
	touchMasterData
} from './master-data';
import type { MasterDataItem } from './master-data';

const ctx = { createdBy: 'sa-user' };

function makeItem(partial: Partial<MasterDataItem> = {}): MasterDataItem {
	return {
		code: 'elderly',
		label_th: 'ผู้สูงอายุ',
		label_en: 'Elderly',
		is_default: false,
		status: 'active',
		...partial
	};
}

describe('CR-112 vulnerable_group active set', () => {
	it('lists the ratified active codes including disability_other, chronic_illness, infant, young_child', () => {
		expect(CR112_VULNERABLE_GROUP_ACTIVE.map((i) => i.code)).toEqual([
			'bedridden',
			'dialysis',
			'wheelchair',
			'psychiatric',
			'elderly_dependent',
			'infant',
			'young_child',
			'pregnant',
			'vision_impaired',
			'hearing_impaired',
			'disability_other',
			'chronic_illness'
		]);
		expect(CR112_VULNERABLE_GROUP_ACTIVE.map((i) => i.code)).not.toContain('elderly');
		expect(CR112_VULNERABLE_GROUP_ACTIVE.map((i) => i.code)).not.toContain('disabled');
		expect(CR112_VULNERABLE_GROUP_ACTIVE.filter((i) => i.is_default)).toEqual([]);
	});

	it('includes bilingual labels', () => {
		expect(CR112_VULNERABLE_GROUP_ACTIVE[0]).toMatchObject({
			label_th: expect.any(String),
			label_en: expect.any(String)
		});
	});
});

describe('masterTypeSchema', () => {
	it('accepts the 4 master types', () => {
		for (const t of [
			'vulnerable_group',
			'housing_type',
			'shelter_type',
			'volunteer_skills'
		] as const) {
			expect(masterTypeSchema.parse(t)).toBe(t);
		}
	});

	it('rejects unknown types', () => {
		expect(() => masterTypeSchema.parse('religion')).toThrow();
		expect(() => masterTypeSchema.parse('pet_types')).toThrow();
		expect(() => masterTypeSchema.parse('municipality_zone')).toThrow();
	});
});

describe('MASTER_DATA_TYPE_META', () => {
	it('covers every master type with shortTitle, title, description, and affectedForms', () => {
		for (const type of MASTER_DATA_TYPES) {
			const meta = MASTER_DATA_TYPE_META[type];
			expect(meta.shortTitle.trim().length).toBeGreaterThan(0);
			expect(meta.title.trim().length).toBeGreaterThan(0);
			expect(meta.description.trim().length).toBeGreaterThan(0);
			expect(meta.affectedForms.length).toBeGreaterThan(0);
		}
	});

	it('uses the locked Thai shortTitles for the hub sidebar', () => {
		expect(MASTER_DATA_TYPE_META.vulnerable_group.shortTitle).toBe('กลุ่มเปราะบาง');
		expect(MASTER_DATA_TYPE_META.housing_type.shortTitle).toBe('ประเภทที่อยู่');
		expect(MASTER_DATA_TYPE_META.shelter_type.shortTitle).toBe('ประเภทศูนย์');
		expect(MASTER_DATA_TYPE_META.volunteer_skills.shortTitle).toBe('ทักษะอาสา');
	});
});

describe('formatMasterLabel', () => {
	const item = makeItem({ code: 'chronic_illness', label_th: 'โรคเรื้อรัง', label_en: 'Chronic' });

	it('picks Thai by default and falls back en → code', () => {
		expect(formatMasterLabel(item)).toBe('โรคเรื้อรัง');
		expect(formatMasterLabel(item, 'th')).toBe('โรคเรื้อรัง');
		expect(formatMasterLabel({ ...item, label_th: '' }, 'th')).toBe('Chronic');
		expect(formatMasterLabel({ ...item, label_th: '', label_en: '' }, 'th')).toBe(
			'chronic_illness'
		);
	});

	it('picks English when lang is en', () => {
		expect(formatMasterLabel(item, 'en')).toBe('Chronic');
		expect(formatMasterLabel({ ...item, label_en: '' }, 'en')).toBe('โรคเรื้อรัง');
	});

	it('returns empty for nullish item', () => {
		expect(formatMasterLabel(null)).toBe('');
		expect(formatMasterLabel(undefined)).toBe('');
	});
});

describe('formatMasterLabelByCode', () => {
	const items = [makeItem({ code: 'a', label_th: 'ก', label_en: 'A' })];

	it('resolves from the list', () => {
		expect(formatMasterLabelByCode('a', items, 'en')).toBe('A');
	});

	it('hides unresolved item_* codes and returns other unknowns as-is', () => {
		expect(formatMasterLabelByCode('item_01abc', items)).toBe('');
		expect(formatMasterLabelByCode('orphan', items)).toBe('orphan');
	});
});

describe('normalizeMasterCode / isLegacyItemCode', () => {
	it('normalizes valid snake codes', () => {
		expect(normalizeMasterCode(' Chronic Illness ')).toBe('chronic_illness');
		expect(normalizeMasterCode('Foo-Bar')).toBe('foo_bar');
	});

	it('rejects invalid codes', () => {
		expect(normalizeMasterCode('')).toBeNull();
		expect(normalizeMasterCode('Bad!')).toBeNull();
		expect(normalizeMasterCode(null)).toBeNull();
	});

	it('detects legacy item_* codes', () => {
		expect(isLegacyItemCode('item_01m3abc')).toBe(true);
		expect(isLegacyItemCode('chronic_illness')).toBe(false);
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

		it('ignores zero-width characters that JS \\s does not match', () => {
			expect(normalizeLabel('สุ\u200Bนัข')).toBe(normalizeLabel('สุนัข'));
			expect(normalizeLabel('สุ\uFEFFนัข')).toBe(normalizeLabel('สุนัข'));
		});
	});

	describe('findDuplicateLabel', () => {
		const items = [
			makeItem({ code: 'a', label_th: 'ผู้สูงอายุ', label_en: 'Elderly' }),
			makeItem({
				code: 'b',
				label_th: 'ผู้พิการ',
				label_en: 'Disabled',
				status: 'inactive'
			})
		];

		it('finds a collision that differs only by surrounding whitespace', () => {
			expect(findDuplicateLabel(items, '  ผู้สูงอายุ ', 'label_th')?.code).toBe('a');
		});

		it('counts an inactive item as taken', () => {
			expect(findDuplicateLabel(items, 'ผู้พิการ', 'label_th')?.code).toBe('b');
		});

		it('checks English separately', () => {
			expect(findDuplicateLabel(items, 'Elderly', 'label_en')?.code).toBe('a');
			expect(findDuplicateLabel(items, 'Elderly', 'label_th')).toBeUndefined();
		});

		it('returns undefined for a genuinely new label', () => {
			expect(findDuplicateLabel(items, 'สตรีมีครรภ์', 'label_th')).toBeUndefined();
		});

		it('excludes the item being edited so a re-save without rename passes', () => {
			expect(findDuplicateLabel(items, 'ผู้สูงอายุ', 'label_th', 'a')).toBeUndefined();
		});

		it('still blocks renaming one item onto another item label', () => {
			expect(findDuplicateLabel(items, 'ผู้พิการ', 'label_th', 'a')?.code).toBe('b');
		});

		it('returns undefined for a blank label (the required-field rule owns that)', () => {
			expect(findDuplicateLabel(items, '   ', 'label_th')).toBeUndefined();
		});
	});

	describe('findLabelCollision', () => {
		it('detects a duplicate Thai label inside the submitted list', () => {
			const dup = findLabelCollision([
				makeItem({ code: 'a', label_th: 'สุนัข', label_en: 'Dog' }),
				makeItem({ code: 'b', label_th: ' สุนัข ', label_en: 'Puppy' })
			]);
			expect(dup).toBe(' สุนัข ');
		});

		it('detects a duplicate English label', () => {
			const dup = findLabelCollision([
				makeItem({ code: 'a', label_th: 'สุนัข', label_en: 'Dog' }),
				makeItem({ code: 'b', label_th: 'หมา', label_en: 'dog' })
			]);
			expect(dup?.toLowerCase()).toBe('dog');
		});

		it('allows the same text across languages on different items', () => {
			expect(
				findLabelCollision([
					makeItem({ code: 'a', label_th: 'Dog', label_en: 'Canine' }),
					makeItem({ code: 'b', label_th: 'หมา', label_en: 'Dog' })
				])
			).toBeUndefined();
		});

		it('detects a shelter-local item colliding with a global one', () => {
			const local = [makeItem({ code: 'local', label_th: 'แมว', label_en: 'Cat' })];
			const global = [makeItem({ code: 'global', label_th: 'แมว', label_en: 'Feline' })];
			expect(findLabelCollision(local, global)).toBe('แมว');
		});

		it('returns undefined when the list and the global tier are both clean', () => {
			const local = [makeItem({ code: 'local', label_th: 'กระต่าย', label_en: 'Rabbit' })];
			const global = [makeItem({ code: 'global', label_th: 'แมว', label_en: 'Cat' })];
			expect(findLabelCollision(local, global)).toBeUndefined();
		});

		it('returns undefined for an empty list', () => {
			expect(findLabelCollision([])).toBeUndefined();
		});

		it('skips a collision whose label was already duplicated before the write', () => {
			const legacy = [
				makeItem({ code: 'a', label_th: 'สุนัข', label_en: 'Dog A' }),
				makeItem({ code: 'b', label_th: 'สุนัข', label_en: 'Dog B' })
			];
			const grandfathered = duplicateLabelKeys(legacy);
			expect(findLabelCollision(legacy, [], grandfathered)).toBeUndefined();
		});

		it('still rejects a NEW duplicate on a doc that already had a legacy one', () => {
			const legacy = [
				makeItem({ code: 'a', label_th: 'สุนัข', label_en: 'Dog A' }),
				makeItem({ code: 'b', label_th: 'สุนัข', label_en: 'Dog B' })
			];
			const next = [
				...legacy,
				makeItem({ code: 'c', label_th: 'แมว', label_en: 'Cat' }),
				makeItem({ code: 'd', label_th: 'แมว', label_en: 'Kitty' })
			];
			expect(findLabelCollision(next, [], duplicateLabelKeys(legacy))).toBe('แมว');
		});
	});

	describe('dedupeItemsByCode', () => {
		it('keeps the first occurrence of a repeated code', () => {
			const out = dedupeItemsByCode([
				makeItem({ code: 'dup', label_th: 'ตัวแรก', label_en: 'First' }),
				makeItem({ code: 'other', label_th: 'อื่น', label_en: 'Other' }),
				makeItem({ code: 'dup', label_th: 'สำเนา', label_en: 'Copy' })
			]);
			expect(out.map((i) => i.code)).toEqual(['dup', 'other']);
			expect(out[0].label_th).toBe('ตัวแรก');
		});

		it('leaves a clean list untouched', () => {
			const items = [makeItem({ code: 'a' }), makeItem({ code: 'b' })];
			expect(dedupeItemsByCode(items)).toEqual(items);
		});

		it('handles an empty list', () => {
			expect(dedupeItemsByCode([])).toEqual([]);
		});
	});

	describe('duplicateItemCodes', () => {
		it('reports a code recorded twice', () => {
			const codes = duplicateItemCodes([
				makeItem({ code: 'dup' }),
				makeItem({ code: 'ok' }),
				makeItem({ code: 'dup' })
			]);
			expect([...codes]).toEqual(['dup']);
		});

		it('is empty when every code is distinct', () => {
			expect(duplicateItemCodes([makeItem({ code: 'a' }), makeItem({ code: 'b' })]).size).toBe(0);
		});
	});

	describe('duplicateLabelKeys', () => {
		it('reports only labels that appear more than once (scoped by language)', () => {
			const keys = duplicateLabelKeys([
				makeItem({ code: 'a', label_th: 'สุนัข', label_en: 'Dog' }),
				makeItem({ code: 'b', label_th: ' สุนัข ', label_en: 'Hound' }),
				makeItem({ code: 'c', label_th: 'แมว', label_en: 'Cat' })
			]);
			expect([...keys]).toEqual(['label_th:สุนัข']);
		});

		it('detects a duplicate spanning two groups (global vs shelter-local)', () => {
			const keys = duplicateLabelKeys(
				[makeItem({ code: 'g', label_th: 'แมว', label_en: 'Cat' })],
				[makeItem({ code: 'l', label_th: 'แมว', label_en: 'Kitty' })]
			);
			expect(keys.has('label_th:แมว')).toBe(true);
		});

		it('is empty for a clean list', () => {
			expect(
				duplicateLabelKeys([makeItem({ code: 'a', label_th: 'สุนัข', label_en: 'Dog' })]).size
			).toBe(0);
		});
	});
});

describe('createMasterData', () => {
	it('stamps envelope, master_type, and id', () => {
		const doc = createMasterData('vulnerable_group', [makeItem()], ctx);
		expect(doc._id).toBe('master_data:vulnerable_group');
		expect(doc.type).toBe('master_data');
		expect(doc.schema_v).toBe(4);
		expect(doc.master_type).toBe('vulnerable_group');
		expect(doc.items).toHaveLength(1);
		expect(doc.created_by).toBe('sa-user');
		expect(doc.created_at).toBe(doc.updated_at);
	});

	it('passes masterDataSchema validation', () => {
		const doc = createMasterData(
			'housing_type',
			[
				makeItem({ code: 'house', label_th: 'บ้านเดี่ยว', label_en: 'House' }),
				makeItem({ code: 'apartment', label_th: 'อพาร์ตเมนต์', label_en: 'Apartment' })
			],
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
		const doc = createMasterData('housing_type', [makeItem()], ctx);
		const old = doc.updated_at;
		vi.advanceTimersByTime(100);
		const out = touchMasterData(doc);
		expect(out.updated_at).not.toBe(old);
		expect(typeof out.updated_at).toBe('string');
	});
});

describe('applyItemOp', () => {
	it('add requires a valid user-supplied code (no ULID fallback)', () => {
		const items = [makeItem()];
		expect(() =>
			applyItemOp(items, {
				kind: 'add',
				code: '',
				label_th: 'ผู้พิการ',
				label_en: 'Disabled'
			})
		).toThrow(/code is required/i);

		const out = applyItemOp(items, {
			kind: 'add',
			code: 'disability_other',
			label_th: 'ผู้พิการ',
			label_en: 'Disabled'
		});
		expect(out).toHaveLength(2);
		expect(out[1].code).toBe('disability_other');
		expect(out[1].label_th).toBe('ผู้พิการ');
		expect(out[1].label_en).toBe('Disabled');
		expect(out[1].status).toBe('active');
	});

	it('add rejects a duplicate code', () => {
		expect(() =>
			applyItemOp([makeItem({ code: 'a' })], {
				kind: 'add',
				code: 'a',
				label_th: 'ใหม่',
				label_en: 'New'
			})
		).toThrow(/already exists/);
	});

	it('add with is_default unsets previous default', () => {
		const items = [makeItem({ is_default: true })];
		const out = applyItemOp(items, {
			kind: 'add',
			code: 'disability_other',
			label_th: 'ผู้พิการ',
			label_en: 'Disabled',
			is_default: true
		});
		expect(out[0].is_default).toBe(false);
		expect(out[1].is_default).toBe(true);
	});

	it('edit updates bilingual labels only', () => {
		const items = [makeItem()];
		const out = applyItemOp(items, {
			kind: 'edit',
			code: 'elderly',
			label_th: 'ผู้สูงอายุ (60+)',
			label_en: 'Elderly (60+)'
		});
		expect(out[0].label_th).toBe('ผู้สูงอายุ (60+)');
		expect(out[0].label_en).toBe('Elderly (60+)');
		expect(out[0].code).toBe('elderly');
	});

	it('edit renames legacy item_* codes but not slug codes', () => {
		const legacy = [makeItem({ code: 'item_01abcxyz', label_th: 'เก่า', label_en: 'Old' })];
		const renamed = applyItemOp(legacy, {
			kind: 'edit',
			code: 'item_01abcxyz',
			newCode: 'school',
			label_th: 'โรงเรียน',
			label_en: 'School'
		});
		expect(renamed[0].code).toBe('school');
		expect(renamed[0].label_en).toBe('School');

		expect(() =>
			applyItemOp([makeItem({ code: 'school' })], {
				kind: 'edit',
				code: 'school',
				newCode: 'temple'
			})
		).toThrow(/legacy item_\*/i);
	});

	it('edit updates volunteer category and description', () => {
		const items = [
			makeItem({
				code: 'first_aid',
				label_th: 'ปฐมพยาบาล',
				label_en: 'First aid',
				category: 'operational',
				description: 'old'
			})
		];
		const out = applyItemOp(items, {
			kind: 'edit',
			code: 'first_aid',
			category: 'controlled',
			description: 'ใหม่'
		});
		expect(out[0]).toMatchObject({
			code: 'first_aid',
			category: 'controlled',
			description: 'ใหม่'
		});
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

	it('delete removes the item by code', () => {
		const items = [makeItem({ code: 'a' }), makeItem({ code: 'b' })];
		const out = applyItemOp(items, { kind: 'delete', code: 'a' });
		expect(out).toHaveLength(1);
		expect(out[0].code).toBe('b');
	});
});

describe('parent_code (optional item field)', () => {
	it('masterDataItemSchema accepts item with parent_code', () => {
		const item = masterDataItemSchema.parse({
			code: 'item_a',
			label_th: 'รายการย่อย',
			label_en: 'Child item',
			is_default: false,
			parent_code: 'parent_1'
		});
		expect(item.parent_code).toBe('parent_1');
	});

	it('masterDataItemSchema accepts item without parent_code', () => {
		const item = masterDataItemSchema.parse({
			code: 'house',
			label_th: 'บ้านเดี่ยว',
			label_en: 'House',
			is_default: true
		});
		expect(item.parent_code).toBeUndefined();
	});

	it('masterDataItemSchema lifts legacy single label to th/en', () => {
		const item = masterDataItemSchema.parse({
			code: 'house',
			label: 'บ้านเดี่ยว',
			is_default: true
		});
		expect(item.label_th).toBe('บ้านเดี่ยว');
		expect(item.label_en).toBe('บ้านเดี่ยว');
	});

	it('masterDataItemSchema rejects missing English when no legacy label', () => {
		expect(() =>
			masterDataItemSchema.parse({
				code: 'house',
				label_th: 'บ้าน',
				is_default: true
			})
		).toThrow();
	});

	it('createMasterData accepts shelter_type', () => {
		const doc = createMasterData(
			'shelter_type',
			[
				makeItem({
					code: 'school',
					label_th: 'โรงเรียน',
					label_en: 'School',
					is_default: true
				})
			],
			ctx
		);
		expect(doc._id).toBe('master_data:shelter_type');
		expect(doc.master_type).toBe('shelter_type');
	});

	it('creates a shelter-local document when a shelter code is supplied', () => {
		const doc = createMasterData(
			'shelter_type',
			[
				makeItem({
					code: 'school',
					label_th: 'โรงเรียน',
					label_en: 'School',
					is_default: true
				})
			],
			ctx,
			'SH001'
		);
		expect(doc._id).toBe('master_data:shelter_type:SH001');
		expect(doc.schema_v).toBe(4);
		expect(doc.shelter_code).toBe('SH001');
	});
});

describe('masterDataItemSchema status default', () => {
	it('defaults status to active when omitted', () => {
		const item = masterDataItemSchema.parse({
			code: 'z1',
			label_th: 'เขต 1',
			label_en: 'Zone 1',
			is_default: true
		});
		expect(item.status).toBe('active');
	});
});

describe('needsMasterDataMigration', () => {
	const v4Doc = {
		_id: 'master_data:housing_type',
		type: 'master_data' as const,
		schema_v: 4,
		master_type: 'housing_type' as const,
		items: [
			{
				code: 'house',
				label_th: 'House',
				label_en: 'House',
				is_default: true,
				status: 'active' as const
			}
		],
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		created_by: 'seed'
	};

	it('is false for a clean v4 doc', () => {
		expect(needsMasterDataMigration(v4Doc)).toBe(false);
	});

	it('is true when schema_v < 4', () => {
		expect(needsMasterDataMigration({ ...v4Doc, schema_v: 3 })).toBe(true);
		expect(needsMasterDataMigration({ ...v4Doc, schema_v: 2 })).toBe(true);
	});

	it('is true when excluded_codes is still present', () => {
		expect(needsMasterDataMigration({ ...v4Doc, excluded_codes: ['house'] })).toBe(true);
	});

	it('is true when any item is missing status', () => {
		expect(
			needsMasterDataMigration({
				...v4Doc,
				items: [{ code: 'house', label_th: 'House', label_en: 'House', is_default: true }]
			})
		).toBe(true);
	});
});

describe('migrateMasterDataToV4', () => {
	it('lifts legacy label, backfills status, drops excluded_codes, stamps schema_v 4', () => {
		const legacy = {
			_id: 'master_data:housing_type:SH001',
			type: 'master_data' as const,
			schema_v: 2,
			master_type: 'housing_type' as const,
			shelter_code: 'SH001',
			items: [
				{ code: 'house', label: 'House', is_default: true },
				{
					code: 'apartment',
					label: 'Apartment',
					is_default: false,
					status: 'inactive' as const
				}
			],
			excluded_codes: ['condo'],
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			created_by: 'seed'
		};
		const v4 = migrateMasterDataToV4(legacy);
		expect(v4.schema_v).toBe(4);
		expect(v4.items[0]).toMatchObject({
			label_th: 'House',
			label_en: 'House',
			status: 'active'
		});
		expect(v4.items[1].status).toBe('inactive');
		expect((v4 as { excluded_codes?: string[] }).excluded_codes).toBeUndefined();
		expect(v4.shelter_code).toBe('SH001');
	});

	it('is idempotent — a v4 doc round-trips unchanged (except identity)', () => {
		const v4 = {
			_id: 'master_data:housing_type',
			type: 'master_data' as const,
			schema_v: 4,
			master_type: 'housing_type' as const,
			items: [
				{
					code: 'house',
					label_th: 'House',
					label_en: 'House',
					is_default: true,
					status: 'active' as const
				}
			],
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			created_by: 'seed'
		};
		expect(migrateMasterDataToV4(v4)).toEqual(v4);
	});
});
