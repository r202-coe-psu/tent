import { describe, expect, it } from 'vitest';
import { overridesForScenarioMode } from './scenario-mode';

describe('scenario mode', () => {
	it('excludes an advanced override draft from general simulation', () => {
		expect(overridesForScenarioMode('general', { water_l_per_person_day: '18' })).toEqual({});
	});

	it('copies the override draft for SOP override simulation', () => {
		const draft = { water_l_per_person_day: '18' };
		const effective = overridesForScenarioMode('sop_override', draft);
		expect(effective).toEqual(draft);
		expect(effective).not.toBe(draft);
	});
});
