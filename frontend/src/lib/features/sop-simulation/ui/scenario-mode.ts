import type { RatioOverrides } from '../domain/scenario.schema';

export type ScenarioMode = 'general' | 'sop_override';

export function overridesForScenarioMode(
	mode: ScenarioMode,
	draft: RatioOverrides
): RatioOverrides {
	return mode === 'general' ? {} : { ...draft };
}
