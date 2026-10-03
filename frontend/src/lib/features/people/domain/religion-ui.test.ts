import { describe, expect, it } from 'vitest';
import { normalizeReligionForUi, RELIGION_UI_VALUES } from './religion-ui';

describe('religion-ui', () => {
	it('exposes พุทธ/อิสลาม/คริสต์/ไม่ระบุ values without other', () => {
		expect([...RELIGION_UI_VALUES]).toEqual([
			'buddhist',
			'muslim',
			'christian',
			'other',
			'unknown'
		]);
		expect(RELIGION_UI_VALUES).toContain('other');
	});

	it('maps legacy other / null to unknown for the select', () => {
		expect(normalizeReligionForUi('other')).toBe('other');
		expect(normalizeReligionForUi('jedi')).toBe('unknown');
		expect(normalizeReligionForUi(null)).toBe('unknown');
		expect(normalizeReligionForUi('buddhist')).toBe('buddhist');
	});
});
