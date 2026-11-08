import { describe, expect, it } from 'vitest';
import {
	MASTER_DATA_TYPES,
	MASTER_DATA_TYPE_LABELS,
	MASTER_DATA_TYPE_META,
	masterDataTypeLabelsByLanguage,
	masterDataTypeMetaByLanguage
} from './master-data';

const hasThai = (v: unknown) => /[฀-๿]/.test(JSON.stringify(v));

describe('master data type labels by language', () => {
	it('serves the original Thai map for th', () => {
		expect(masterDataTypeLabelsByLanguage.th).toBe(MASTER_DATA_TYPE_LABELS);
	});

	it('serves English labels with exactly the master types for en', () => {
		const en = masterDataTypeLabelsByLanguage.en;
		expect(Object.keys(en).sort()).toEqual([...MASTER_DATA_TYPES].sort());
		expect(en.vulnerable_group).toBe('Vulnerable group');
		expect(en.chronic_disease).toBe('Chronic disease');
		expect(hasThai(en)).toBe(false);
	});
});

describe('master data type meta by language', () => {
	it('serves the original Thai meta for th', () => {
		expect(masterDataTypeMetaByLanguage.th).toBe(MASTER_DATA_TYPE_META);
	});

	it('serves English meta with the same types and form counts for en', () => {
		const th = masterDataTypeMetaByLanguage.th;
		const en = masterDataTypeMetaByLanguage.en;
		expect(Object.keys(en).sort()).toEqual(Object.keys(th).sort());
		for (const type of MASTER_DATA_TYPES) {
			expect(en[type].affectedForms).toHaveLength(th[type].affectedForms.length);
		}
		expect(en.housing_type.shortTitle).toBe('Housing type');
		expect(en.allergy.affectedForms).toContain('Station 2 health screening');
		expect(hasThai(en)).toBe(false);
	});
});
