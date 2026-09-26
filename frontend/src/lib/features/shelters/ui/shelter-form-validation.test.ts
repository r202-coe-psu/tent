import { describe, expect, it } from 'vitest';
import {
	SHELTER_SECTION_FIELDS,
	collectErrorMessages,
	collectErrorMessagesForFields,
	findInvalidSectionIds,
	sectionHasFieldErrors,
	topLevelErrorKeys
} from './shelter-form-validation';

describe('shelter-form-validation', () => {
	const sampleErrors = {
		name: ['ชื่อศูนย์พักพิงต้องไม่ว่าง'],
		capacity: ['ความจุสูงสุดต้องมากกว่า 0'],
		utilities: {
			vhf_channel: ['ต้องเลือก VHF ในระบบสื่อสารก่อนระบุช่องสัญญาณ']
		},
		zones: {
			'0': {
				name: ['ชื่อโซนต้องไม่ว่าง']
			}
		}
	};

	it('lists top-level error keys without _errors', () => {
		expect(topLevelErrorKeys({ name: ['x'], _errors: ['y'] })).toEqual(['name']);
		expect(topLevelErrorKeys(null)).toEqual([]);
	});

	it('maps errored fields onto section ids in canonical order', () => {
		expect(findInvalidSectionIds(sampleErrors)).toEqual([
			'basic-info',
			'capacity',
			'zones-facilities',
			'utilities'
		]);
		expect(sectionHasFieldErrors('basic-info', sampleErrors)).toBe(true);
		expect(sectionHasFieldErrors('risk', sampleErrors)).toBe(false);
	});

	it('maps feature_flags errors to basic-info', () => {
		expect(
			findInvalidSectionIds({ feature_flags: { enable_medical_screening: ['invalid'] } })
		).toEqual(['basic-info']);
		expect(SHELTER_SECTION_FIELDS['basic-info']).toContain('feature_flags');
	});

	it('maps food_distribution_points errors to food-distribution only', () => {
		const errors = {
			food_distribution_points: {
				'0': {
					name: ['กรุณาระบุชื่อจุดแจกอาหาร']
				}
			}
		};
		expect(findInvalidSectionIds(errors)).toEqual(['food-distribution']);
		expect(sectionHasFieldErrors('food-distribution', errors)).toBe(true);
		expect(sectionHasFieldErrors('zones-facilities', errors)).toBe(false);
		expect(SHELTER_SECTION_FIELDS['food-distribution']).toEqual(['food_distribution_points']);
		expect(SHELTER_SECTION_FIELDS['zones-facilities']).not.toContain('food_distribution_points');
	});

	it('maps common_areas.sub_storage errors to storage-points, not zones-facilities', () => {
		const errors = {
			common_areas: { sub_storage: { '0': { name: ['ชื่อสถานที่จัดเก็บต้องไม่ว่าง'] } } }
		};
		expect(findInvalidSectionIds(errors)).toEqual(['storage-points']);
		expect(sectionHasFieldErrors('storage-points', errors)).toBe(true);
		expect(sectionHasFieldErrors('zones-facilities', errors)).toBe(false);
		expect(collectErrorMessagesForFields(errors, 'storage-points')).toEqual([
			'ชื่อสถานที่จัดเก็บต้องไม่ว่าง'
		]);
		expect(collectErrorMessagesForFields(errors, 'zones-facilities')).toEqual([]);
	});

	it('keeps other common_areas errors on zones-facilities', () => {
		const errors = {
			common_areas: {
				parking_capacity: ['ต้องไม่ติดลบ'],
				sub_storage: { '0': { name: ['ชื่อสถานที่จัดเก็บต้องไม่ว่าง'] } }
			}
		};
		expect(findInvalidSectionIds(errors)).toEqual(['zones-facilities', 'storage-points']);
		expect(collectErrorMessagesForFields(errors, 'zones-facilities')).toEqual(['ต้องไม่ติดลบ']);
	});

	it('keeps the canonical section id order', () => {
		expect(Object.keys(SHELTER_SECTION_FIELDS)).toEqual([
			'basic-info',
			'capacity',
			'zones-facilities',
			'food-distribution',
			'storage-points',
			'utilities',
			'risk',
			'admission-policy',
			'luggage-policy',
			'parking-policy'
		]);
		expect(SHELTER_SECTION_FIELDS['zones-facilities']).toEqual([
			'zones',
			'facilities',
			'common_areas'
		]);
	});

	it('flattens nested error messages uniquely', () => {
		expect(collectErrorMessages(sampleErrors)).toEqual([
			'ชื่อศูนย์พักพิงต้องไม่ว่าง',
			'ความจุสูงสุดต้องมากกว่า 0',
			'ต้องเลือก VHF ในระบบสื่อสารก่อนระบุช่องสัญญาณ',
			'ชื่อโซนต้องไม่ว่าง'
		]);
	});

	it('collects messages only for the requested section', () => {
		expect(collectErrorMessagesForFields(sampleErrors, 'basic-info')).toEqual([
			'ชื่อศูนย์พักพิงต้องไม่ว่าง'
		]);
		expect(collectErrorMessagesForFields(sampleErrors, 'capacity')).toEqual([
			'ความจุสูงสุดต้องมากกว่า 0'
		]);
		expect(collectErrorMessagesForFields(sampleErrors, 'risk')).toEqual([]);
		expect(
			collectErrorMessagesForFields(
				{ food_distribution_points: { '0': { name: ['กรุณาระบุชื่อจุดแจกอาหาร'] } } },
				'food-distribution'
			)
		).toEqual(['กรุณาระบุชื่อจุดแจกอาหาร']);
	});
});
