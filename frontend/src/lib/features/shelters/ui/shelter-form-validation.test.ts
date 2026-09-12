import { describe, expect, it } from 'vitest';
import {
	SHELTER_STEP_FIELDS,
	collectErrorMessages,
	collectErrorMessagesForFields,
	findInvalidStepIndexes,
	stepHasFieldErrors,
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

	it('maps errored fields onto wizard step indexes', () => {
		expect(findInvalidStepIndexes(sampleErrors)).toEqual([0, 1, 2, 3]);
		expect(stepHasFieldErrors(0, sampleErrors)).toBe(true);
		expect(stepHasFieldErrors(4, sampleErrors)).toBe(false);
	});

	it('maps feature_flags errors to step 0 (basic info)', () => {
		expect(
			findInvalidStepIndexes({ feature_flags: { enable_medical_screening: ['invalid'] } })
		).toEqual([0]);
		expect(SHELTER_STEP_FIELDS[0]).toContain('feature_flags');
	});

	it('flattens nested error messages uniquely', () => {
		expect(collectErrorMessages(sampleErrors)).toEqual([
			'ชื่อศูนย์พักพิงต้องไม่ว่าง',
			'ความจุสูงสุดต้องมากกว่า 0',
			'ต้องเลือก VHF ในระบบสื่อสารก่อนระบุช่องสัญญาณ',
			'ชื่อโซนต้องไม่ว่าง'
		]);
	});

	it('collects messages only for requested fields', () => {
		expect(collectErrorMessagesForFields(sampleErrors, SHELTER_STEP_FIELDS[0]!)).toEqual([
			'ชื่อศูนย์พักพิงต้องไม่ว่าง'
		]);
		expect(collectErrorMessagesForFields(sampleErrors, SHELTER_STEP_FIELDS[1]!)).toEqual([
			'ความจุสูงสุดต้องมากกว่า 0'
		]);
	});
});
