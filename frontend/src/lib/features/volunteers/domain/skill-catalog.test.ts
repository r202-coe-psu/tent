import { describe, expect, it } from 'vitest';
import {
	controlledSkillValues,
	hasAnyRequiredSkill,
	normalizeSkillText,
	resolveSkillLabel,
	resolveSkillOption,
	skillMatches,
	skillOptionsFromMaster,
	toSkillCode,
	toSkillCodes,
	type MasterSkillItem
} from './skill-catalog';

const MASTER: MasterSkillItem[] = [
	{ code: 'kitchen', label: 'ประกอบอาหาร / ครัวสนาม', category: 'operational', status: 'active' },
	{
		code: 'medical',
		label: 'การแพทย์ / ปฐมพยาบาล',
		category: 'controlled',
		description: 'ต้องตรวจใบประกอบวิชาชีพ',
		status: 'active'
	},
	{ code: 'retired', label: 'ทักษะที่เลิกใช้', category: 'operational', status: 'inactive' }
];

const OPTIONS = skillOptionsFromMaster(MASTER);

describe('skillOptionsFromMaster', () => {
	it('keeps active items in master order and drops inactive ones', () => {
		expect(OPTIONS.map((o) => o.code)).toEqual(['kitchen', 'medical']);
	});

	it('marks controlled items from `category` (both casings)', () => {
		expect(OPTIONS.find((o) => o.code === 'medical')?.controlled).toBe(true);
		expect(OPTIONS.find((o) => o.code === 'kitchen')?.controlled).toBe(false);
		const upper = skillOptionsFromMaster([{ code: 'm', label: 'M', category: 'CONTROLLED' }]);
		expect(upper[0].controlled).toBe(true);
	});

	it('defaults description to an empty string rather than undefined', () => {
		expect(OPTIONS.find((o) => o.code === 'kitchen')?.description).toBe('');
	});
});

describe('resolveSkillOption', () => {
	it('resolves a stored code', () => {
		expect(resolveSkillOption('medical', OPTIONS)?.label).toBe('การแพทย์ / ปฐมพยาบาล');
	});

	it('resolves a pre-CR-100 stored label', () => {
		expect(resolveSkillOption('การแพทย์ / ปฐมพยาบาล', OPTIONS)?.code).toBe('medical');
	});

	it('resolves a label that differs only by case, spacing or NFC form', () => {
		expect(resolveSkillOption('  KITCHEN ', OPTIONS)?.code).toBe('kitchen');
		const decomposed = 'ประกอบอาหาร / ครัวสนาม'.normalize('NFD');
		expect(resolveSkillOption(decomposed, OPTIONS)?.code).toBe('kitchen');
	});

	it('returns undefined for a value master data no longer carries', () => {
		expect(resolveSkillOption('ทักษะที่เลิกใช้', OPTIONS)).toBeUndefined();
	});
});

describe('resolveSkillLabel / toSkillCode', () => {
	it('labels a code and falls back to the raw value when unknown', () => {
		expect(resolveSkillLabel('kitchen', OPTIONS)).toBe('ประกอบอาหาร / ครัวสนาม');
		expect(resolveSkillLabel('ทักษะลับ', OPTIONS)).toBe('ทักษะลับ');
	});

	it('canonicalises a legacy label to its code and leaves unknowns alone', () => {
		expect(toSkillCode('การแพทย์ / ปฐมพยาบาล', OPTIONS)).toBe('medical');
		expect(toSkillCode('ทักษะลับ', OPTIONS)).toBe('ทักษะลับ');
	});

	it('maps a mixed list to codes and de-duplicates what collapses', () => {
		expect(toSkillCodes(['medical', 'การแพทย์ / ปฐมพยาบาล', 'kitchen'], OPTIONS)).toEqual([
			'medical',
			'kitchen'
		]);
	});
});

describe('controlledSkillValues', () => {
	it('lists each controlled skill by code AND label so legacy docs still gate', () => {
		expect(controlledSkillValues(OPTIONS)).toEqual(['medical', 'การแพทย์ / ปฐมพยาบาล']);
	});

	it('is empty when master data marks nothing controlled', () => {
		expect(controlledSkillValues(skillOptionsFromMaster([MASTER[0]]))).toEqual([]);
	});
});

describe('skillMatches', () => {
	it('matches a job code against a volunteer label', () => {
		expect(skillMatches('การแพทย์ / ปฐมพยาบาล', 'medical', OPTIONS)).toBe(true);
	});

	it('does not match two different skills', () => {
		expect(skillMatches('kitchen', 'medical', OPTIONS)).toBe(false);
	});

	it('still compares unknown values textually', () => {
		expect(skillMatches('ทักษะลับ', ' ทักษะลับ ', OPTIONS)).toBe(true);
		expect(skillMatches('ทักษะลับ', 'อื่น', OPTIONS)).toBe(false);
	});
});

describe('hasAnyRequiredSkill', () => {
	it('reads an empty requirement as satisfied', () => {
		expect(hasAnyRequiredSkill([], [], OPTIONS)).toBe(true);
	});

	it('matches across the code/label boundary', () => {
		expect(hasAnyRequiredSkill(['การแพทย์ / ปฐมพยาบาล'], ['medical'], OPTIONS)).toBe(true);
		expect(hasAnyRequiredSkill(['kitchen'], ['medical'], OPTIONS)).toBe(false);
	});
});

describe('normalizeSkillText', () => {
	it('trims, lowercases and NFC-composes', () => {
		expect(normalizeSkillText('  Medical  ')).toBe('medical');
		expect(normalizeSkillText('ปฐมพยาบาล'.normalize('NFD'))).toBe('ปฐมพยาบาล'.normalize('NFC'));
	});
});
