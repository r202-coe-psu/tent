import { describe, expect, it } from 'vitest';
import { checkRequiredSkills } from './required-skills';
import type { SkillOption } from './skill-catalog';

const OPTIONS: SkillOption[] = [
	{ code: 'medical', label: 'การแพทย์ / ปฐมพยาบาล', description: '', icon: '', controlled: true },
	{ code: 'kitchen', label: 'ประกอบอาหาร / ครัวสนาม', description: '', icon: '', controlled: false }
];
const verified = { status: 'verified' as const };
const rejected = { status: 'rejected' as const };

describe('checkRequiredSkills', () => {
	it('flags a required skill the applicant never claimed', () => {
		expect(checkRequiredSkills(['medical'], ['kitchen'], OPTIONS, null)).toEqual([
			{ code: 'medical', label: 'การแพทย์ / ปฐมพยาบาล', controlled: true, state: 'missing' }
		]);
	});

	it('tells a certified skill from one still waiting for its certificate check', () => {
		const states = (volunteer: Parameters<typeof checkRequiredSkills>[3]) =>
			checkRequiredSkills(['medical'], ['medical'], OPTIONS, volunteer).map((c) => c.state);
		expect(states({ skill_verifications: { medical: verified } })).toEqual(['certified']);
		expect(states({ skill_verifications: { medical: rejected } })).toEqual(['rejected']);
		expect(states({ skill_verifications: {} })).toEqual(['uncertified']);
		expect(states(null)).toEqual(['uncertified']);
	});

	it('needs no certificate for an ordinary skill', () => {
		expect(checkRequiredSkills(['kitchen'], ['kitchen'], OPTIONS, null)[0].state).toBe('has');
	});

	it('matches a legacy label to its code, both on the job and the applicant', () => {
		const [check] = checkRequiredSkills(
			['การแพทย์ / ปฐมพยาบาล'],
			['การแพทย์ / ปฐมพยาบาล'],
			OPTIONS,
			{ skill_verifications: { 'การแพทย์ / ปฐมพยาบาล': verified } }
		);
		expect(check).toMatchObject({ code: 'medical', state: 'certified' });
	});

	it('lists each skill once, in the job order, and drops ones Master Data lost', () => {
		expect(
			checkRequiredSkills(['kitchen', 'item_gone', 'medical', 'kitchen'], [], OPTIONS, null).map(
				(c) => c.code
			)
		).toEqual(['kitchen', 'medical']);
	});
});
