import { describe, expect, it } from 'vitest';
import { findSkillOption, localizedSkillLabel, skillLabel, skillLabels } from './skill-label';
import type { VolunteerSkillOption } from './volunteer';

const OPTIONS: VolunteerSkillOption[] = [
	{
		code: 'medical',
		label: 'การแพทย์ / ปฐมพยาบาล',
		label_th: 'การแพทย์ / ปฐมพยาบาล',
		label_en: 'Medical / First aid',
		category: 'controlled',
		description: '',
		is_default: false
	},
	{
		code: 'kitchen',
		label: 'ประกอบอาหาร / ครัวสนาม',
		label_th: 'ประกอบอาหาร / ครัวสนาม',
		label_en: '',
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

	it('finds a legacy English label', () => {
		expect(findSkillOption('medical / first aid', OPTIONS)?.code).toBe('medical');
	});

	it('returns undefined for a value the list no longer carries', () => {
		expect(findSkillOption('ทักษะลับ', OPTIONS)).toBeUndefined();
	});

	it('does not match an empty value against a missing label', () => {
		expect(findSkillOption('', OPTIONS)).toBeUndefined();
		expect(findSkillOption('  ', OPTIONS)).toBeUndefined();
	});
});

describe('localizedSkillLabel', () => {
	it('picks the label in the reader language', () => {
		expect(localizedSkillLabel(OPTIONS[0], 'th')).toBe('การแพทย์ / ปฐมพยาบาล');
		expect(localizedSkillLabel(OPTIONS[0], 'en')).toBe('Medical / First aid');
	});

	it('falls back to the other language when one is missing', () => {
		expect(localizedSkillLabel(OPTIONS[1], 'en')).toBe('ประกอบอาหาร / ครัวสนาม');
	});

	it('falls back to the code when the option has no label at all', () => {
		const bare = { ...OPTIONS[1], label: '', label_th: '', label_en: '' };
		expect(localizedSkillLabel(bare, 'th')).toBe('kitchen');
	});
});

describe('skillLabel', () => {
	it('labels a code', () => {
		expect(skillLabel('kitchen', OPTIONS)).toBe('ประกอบอาหาร / ครัวสนาม');
	});

	it('labels in the reader language when asked, falling back when one is missing', () => {
		expect(skillLabel('medical', OPTIONS, 'en')).toBe('Medical / First aid');
		expect(skillLabel('medical', OPTIONS, 'th')).toBe('การแพทย์ / ปฐมพยาบาล');
		expect(skillLabel('kitchen', OPTIONS, 'en')).toBe('ประกอบอาหาร / ครัวสนาม');
	});

	it('labels a real Master Data code even though the code itself looks technical', () => {
		const masterOptions: VolunteerSkillOption[] = [
			{
				code: 'item_01m1vs0fj92e25krt2when7cjc',
				label: 'ประกอบอาหาร / ครัวสนาม',
				label_th: 'ประกอบอาหาร / ครัวสนาม',
				label_en: '',
				category: 'operational',
				description: '',
				is_default: true
			}
		];
		expect(skillLabel('item_01m1vs0fj92e25krt2when7cjc', masterOptions)).toBe(
			'ประกอบอาหาร / ครัวสนาม'
		);
	});

	it('shows an unknown value as-is instead of hiding it', () => {
		expect(skillLabel('ทักษะลับ', OPTIONS)).toBe('ทักษะลับ');
	});

	it('falls back to the raw value when the list has not loaded yet', () => {
		expect(skillLabel('medical', [])).toBe('medical');
	});
});

describe('skillLabels', () => {
	it('keeps the job order and omits values missing from Master Data', () => {
		expect(skillLabels(['kitchen', 'ทักษะลับ'], OPTIONS)).toEqual([
			{ value: 'kitchen', label: 'ประกอบอาหาร / ครัวสนาม' }
		]);
	});
	it('labels in the reader language when asked', () => {
		expect(skillLabels(['medical'], OPTIONS, 'en')).toEqual([
			{ value: 'medical', label: 'Medical / First aid' }
		]);
	});
});
