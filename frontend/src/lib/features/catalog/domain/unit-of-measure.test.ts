import { describe, it, expect } from 'vitest';
import {
	unitOfMeasureInputSchema,
	createUnitOfMeasure,
	isUnitOfMeasure,
	formatUnit,
	canonicalizeUnitCode,
	FALLBACK_UNIT_DEFINITIONS,
	unitCodeSchema,
	type UnitOfMeasure
} from './unit-of-measure';

describe('unit-of-measure domain', () => {
	const mockCtx = {
		shelterCode: 'SH001',
		createdBy: 'admin_test'
	};

	describe('unitOfMeasureInputSchema', () => {
		it('accepts valid input', () => {
			const valid = {
				code: 'kg',
				label_th: 'กิโลกรัม',
				label_th_short: 'กก.',
				label_en: 'kg',
				dimension: 'mass' as const,
				sort_order: 1
			};
			const parsed = unitOfMeasureInputSchema.parse(valid);
			expect(parsed.code).toBe('kg');
			expect(parsed.dimension).toBe('mass');
		});

		it('rejects invalid codes (uppercase, spaces, thai, symbols)', () => {
			expect(() =>
				unitOfMeasureInputSchema.parse({
					code: 'KG',
					label_th: 'กิโลกรัม',
					label_en: 'kg',
					dimension: 'mass'
				})
			).toThrow();

			expect(() =>
				unitOfMeasureInputSchema.parse({
					code: 'k g',
					label_th: 'กิโลกรัม',
					label_en: 'kg',
					dimension: 'mass'
				})
			).toThrow();

			expect(() =>
				unitOfMeasureInputSchema.parse({
					code: 'กิโลกรัม',
					label_th: 'กิโลกรัม',
					label_en: 'kg',
					dimension: 'mass'
				})
			).toThrow();

			expect(() =>
				unitOfMeasureInputSchema.parse({
					code: 'kg_is_too_long_for_sixteen_chars',
					label_th: 'กิโลกรัม',
					label_en: 'kg',
					dimension: 'mass'
				})
			).toThrow();
		});

		it('rejects invalid dimension', () => {
			expect(() =>
				unitOfMeasureInputSchema.parse({
					code: 'box',
					label_th: 'กล่อง',
					label_en: 'box',
					dimension: 'weight' as unknown as 'mass'
				})
			).toThrow();
		});
	});

	describe('createUnitOfMeasure factory', () => {
		it('creates document with deterministic ID and envelope', () => {
			const doc = createUnitOfMeasure(
				{
					code: 'box',
					label_th: 'กล่อง',
					label_en: 'box',
					dimension: 'count',
					is_protected: true
				},
				mockCtx
			);

			expect(doc._id).toBe('unit_of_measure:box');
			expect(doc.type).toBe('unit_of_measure');
			expect(doc.schema_v).toBe(1);
			expect(doc.code).toBe('box');
			expect(doc.label_th).toBe('กล่อง');
			expect(doc.label_en).toBe('box');
			expect(doc.is_protected).toBe(true);
			expect(doc.deactivated).toBe(false);
			expect(doc.created_by).toBe('admin_test');
			expect(doc.created_at).toBeDefined();
			expect(doc.updated_at).toBeDefined();
			expect(isUnitOfMeasure(doc)).toBe(true);
		});
	});

	describe('canonical seed definitions', () => {
		it('contains the 27 canonical units with deterministic IDs and valid dimensions', () => {
			const expectedCodes = [
				'piece',
				'unit',
				'item',
				'set',
				'pair',
				'box',
				'pack',
				'bag',
				'sachet',
				'bottle',
				'can',
				'tablet',
				'bar',
				'tube',
				'roll',
				'sheet',
				'cloth',
				'bundle',
				'egg',
				'fruit',
				'gallon',
				'cylinder',
				'g',
				'kg',
				'ml',
				'l',
				'm'
			];
			const expectedDimensions = [
				...Array.from({ length: 20 }, () => 'count'),
				'volume',
				'count',
				'mass',
				'mass',
				'volume',
				'volume',
				'length'
			];

			expect(FALLBACK_UNIT_DEFINITIONS).toHaveLength(27);
			expect(new Set(FALLBACK_UNIT_DEFINITIONS.map((unit) => unit.code)).size).toBe(27);
			expect(FALLBACK_UNIT_DEFINITIONS.map((unit) => unit.code)).toEqual(expectedCodes);
			expect(
				FALLBACK_UNIT_DEFINITIONS.every((unit) => unitCodeSchema.safeParse(unit.code).success)
			).toBe(true);
			expect(FALLBACK_UNIT_DEFINITIONS.map((unit) => `unit_of_measure:${unit.code}`)).toEqual(
				expectedCodes.map((code) => `unit_of_measure:${code}`)
			);
			expect(FALLBACK_UNIT_DEFINITIONS.map((unit) => unit.dimension)).toEqual(expectedDimensions);
			expect(FALLBACK_UNIT_DEFINITIONS.filter((unit) => unit.dimension === 'count')).toHaveLength(
				21
			);
			expect(FALLBACK_UNIT_DEFINITIONS.filter((unit) => unit.dimension === 'mass')).toHaveLength(2);
			expect(FALLBACK_UNIT_DEFINITIONS.filter((unit) => unit.dimension === 'volume')).toHaveLength(
				3
			);
			expect(FALLBACK_UNIT_DEFINITIONS.filter((unit) => unit.dimension === 'length')).toHaveLength(
				1
			);
			expect(FALLBACK_UNIT_DEFINITIONS.map((unit) => unit.sort_order)).toEqual(
				Array.from({ length: 27 }, (_, index) => index + 1)
			);
		});
	});

	describe('formatUnit', () => {
		const customUnits: UnitOfMeasure[] = [
			{
				_id: 'unit_of_measure:custom_bag',
				type: 'unit_of_measure',
				schema_v: 1,
				code: 'custom_bag',
				label_th: 'กระสอบพิเศษ',
				label_th_short: 'กส.',
				label_en: 'special sack',
				dimension: 'mass',
				created_at: '',
				updated_at: '',
				created_by: 'system'
			}
		];

		it('formats using provided units array', () => {
			expect(formatUnit('custom_bag', customUnits, 'th')).toBe('กระสอบพิเศษ');
			expect(formatUnit('custom_bag', customUnits, 'th', true)).toBe('กส.');
			expect(formatUnit('custom_bag', customUnits, 'en')).toBe('special sack');
		});

		it('formats using fallback table for known system units', () => {
			expect(formatUnit('kg', [], 'th')).toBe('กิโลกรัม');
			expect(formatUnit('kg', [], 'th', true)).toBe('กก.');
			expect(formatUnit('kg', [], 'en')).toBe('kg');

			expect(formatUnit('can', [], 'th')).toBe('กระป๋อง');
			expect(formatUnit('can', [], 'en')).toBe('can');

			expect(formatUnit('piece', [], 'th')).toBe('ชิ้น');
			expect(formatUnit('piece', [], 'en')).toBe('pcs');

			expect(formatUnit('cylinder', [], 'th')).toBe('ถัง');
			expect(formatUnit('cylinder', [], 'en')).toBe('cylinder');
		});

		it('handles legacy Thai unit inputs gracefully', () => {
			expect(formatUnit('ชิ้น', [], 'en')).toBe('pcs');
			expect(formatUnit('กิโลกรัม', [], 'en')).toBe('kg');
			expect(formatUnit('กิโลกรัม', [], 'th', true)).toBe('กก.');
		});

		it('returns raw code if unknown and not in fallbacks', () => {
			expect(formatUnit('unknown_code', [], 'th')).toBe('unknown_code');
			expect(formatUnit('unknown_code', [], 'en')).toBe('unknown_code');
		});

		it('handles empty / undefined inputs safely', () => {
			expect(formatUnit(null)).toBe('');
			expect(formatUnit(undefined)).toBe('');
			expect(formatUnit('')).toBe('');
		});
	});

	describe('canonicalizeUnitCode', () => {
		it('maps canonical codes and legacy display labels to the persisted code', () => {
			expect(canonicalizeUnitCode('piece')).toBe('piece');
			expect(canonicalizeUnitCode('ชิ้น')).toBe('piece');
			expect(canonicalizeUnitCode('กิโลกรัม')).toBe('kg');
		});

		it('uses configured custom UOM labels without introducing a local alias map', () => {
			const custom: UnitOfMeasure = {
				_id: 'unit_of_measure:custom_bag',
				type: 'unit_of_measure',
				schema_v: 1,
				code: 'custom_bag',
				label_th: 'กระสอบพิเศษ',
				label_en: 'special sack',
				dimension: 'mass',
				created_at: '',
				updated_at: '',
				created_by: 'system'
			};
			expect(canonicalizeUnitCode('กระสอบพิเศษ', [custom])).toBe('custom_bag');
			expect(canonicalizeUnitCode('special sack', [custom])).toBe('custom_bag');
		});
	});
});
