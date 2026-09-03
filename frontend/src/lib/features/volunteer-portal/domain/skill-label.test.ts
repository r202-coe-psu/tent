import { describe, expect, it } from 'vitest';
import { findSkillOption, skillLabel, skillLabels } from './skill-label';
import type { VolunteerSkillOption } from './volunteer';

const OPTIONS: VolunteerSkillOption[] = [
	{
		code: 'medical',
		label: 'การแพทย์ / ปฐมพยาบาล',
		category: 'controlled',
		description: '',
		is_default: false
	},
	{
		code: 'kitchen',
		label: 'ประกอบอาหาร / ครัวสนาม',
		category: 'operational',
		description: '',
		is_default: true
	}
];

describe('findSkillOption', () => {
	it('finds a CR-100 code', () => {
		expect(findSkillOption('medical', OPTIONS)?.label).toBe('การแพทย์ / ปฐมพยาบาล');
	});

	it('finds a pre-CR-100 label, ignoring case, spacing and NFC form', () => {
		expect(findSkillOption('ประกอบอาหาร / ครัวสนาม', OPTIONS)?.code).toBe('kitchen');
		expect(findSkillOption(' MEDICAL ', OPTIONS)?.code).toBe('medical');
		expect(findSkillOption('การแพทย์ / ปฐมพยาบาล'.normalize('NFD'), OPTIONS)?.code).toBe('medical');
	});

	it('returns undefined for a value the list no longer carries', () => {
		expect(findSkillOption('ทักษะลับ', OPTIONS)).toBeUndefined();
	});
});

describe('skillLabel', () => {
	it('labels a code', () => {
		expect(skillLabel('kitchen', OPTIONS)).toBe('ประกอบอาหาร / ครัวสนาม');
	});

	it('shows an unknown value as-is instead of hiding it', () => {
		expect(skillLabel('ทักษะลับ', OPTIONS)).toBe('ทักษะลับ');
	});

	it('falls back to the raw value when the list has not loaded yet', () => {
		expect(skillLabel('medical', [])).toBe('medical');
	});
});

describe('skillLabels', () => {
	it('keeps the job order and pairs each value with its label', () => {
		expect(skillLabels(['kitchen', 'ทักษะลับ'], OPTIONS)).toEqual([
			{ value: 'kitchen', label: 'ประกอบอาหาร / ครัวสนาม' },
			{ value: 'ทักษะลับ', label: 'ทักษะลับ' }
		]);
	});
});
