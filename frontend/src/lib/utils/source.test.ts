import { describe, it, expect } from 'vitest';
import {
	sourceSchema,
	SOURCE_LABELS,
	SOURCE_OPTIONS,
	getSourceLabel,
	resolveSource
} from './source';

describe('source utility', () => {
	it('validates sources with sourceSchema', () => {
		expect(sourceSchema.safeParse('SPHERE_BASELINE').success).toBe(true);
		expect(sourceSchema.safeParse('SHELTER_OVERRIDE').success).toBe(true);
		expect(sourceSchema.safeParse('INVALID').success).toBe(false);
	});

	it('provides correct human-readable labels in SOURCE_LABELS', () => {
		expect(SOURCE_LABELS.SPHERE_BASELINE).toBe('ส่วนกลาง');
		expect(SOURCE_LABELS.SHELTER_OVERRIDE).toBe('เฉพาะศูนย์พักพิงนี้');
	});

	it('returns formatted label via getSourceLabel', () => {
		expect(getSourceLabel('SPHERE_BASELINE')).toBe('ส่วนกลาง');
		expect(getSourceLabel('SHELTER_OVERRIDE')).toBe('เฉพาะศูนย์พักพิงนี้');
		expect(getSourceLabel(null)).toBe('—');
		expect(getSourceLabel(undefined)).toBe('—');
		expect(getSourceLabel('CUSTOM_UNKNOWN')).toBe('CUSTOM_UNKNOWN');
	});

	it('resolves source from shelterCode context via resolveSource', () => {
		expect(resolveSource('shelter-01')).toBe('SHELTER_OVERRIDE');
		expect(resolveSource('')).toBe('SPHERE_BASELINE');
		expect(resolveSource(undefined)).toBe('SPHERE_BASELINE');
		expect(resolveSource(null)).toBe('SPHERE_BASELINE');
	});

	it('has SOURCE_OPTIONS matching schema and labels', () => {
		expect(SOURCE_OPTIONS).toHaveLength(2);
		expect(SOURCE_OPTIONS[0]).toEqual({
			value: 'SPHERE_BASELINE',
			label: 'ส่วนกลาง'
		});
		expect(SOURCE_OPTIONS[1]).toEqual({
			value: 'SHELTER_OVERRIDE',
			label: 'เฉพาะศูนย์พักพิงนี้'
		});
	});
});
