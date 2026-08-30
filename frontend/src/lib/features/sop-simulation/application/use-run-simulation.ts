import { createMutation } from '@tanstack/svelte-query';
import {
	calculateResources,
	loadCalculationSnapshot,
	type CalculationSnapshot as ResourceCalculationSnapshot
} from '$lib/features/resource-calc';
import type { SopRatioKey } from '$lib/features/sop-ratios';
import {
	calculationSnapshotSchema,
	scenarioInputSchema,
	scenarioResultSchema,
	type ScenarioInput,
	type ScenarioResult
} from '../domain/scenario.schema';
import { compareScenario, projectHorizon } from '../domain/scenario.projection';

export type CalculationSnapshotLoader = (
	shelterCode: string
) => Promise<ResourceCalculationSnapshot>;

export interface RunSimulationRequest {
	input: ScenarioInput;
	snapshot?: ResourceCalculationSnapshot;
}

export async function runSimulation(
	input: ScenarioInput,
	shelterCode: string,
	loader: CalculationSnapshotLoader = loadCalculationSnapshot
): Promise<ScenarioResult> {
	const parsedInput = scenarioInputSchema.parse(input);
	const rawSnapshot = await loader(shelterCode);
	const snapshot = calculationSnapshotSchema.parse(rawSnapshot);
	if (snapshot.shelter_code !== shelterCode) {
		throw new Error('Calculation snapshot shelter does not match the requested shelter');
	}

	const currentResources = snapshot.resource_inputs.map((resource) => ({ ...resource }));
	const scenarioRatios = { ...snapshot.current_ratios } as Record<SopRatioKey, string>;
	for (const [key, ratio] of Object.entries(parsedInput.ratio_overrides) as Array<
		[SopRatioKey, string | undefined]
	>) {
		if (ratio !== undefined) scenarioRatios[key] = ratio;
	}
	const scenarioResources = currentResources.map((resource) => ({
		...resource,
		ratio: scenarioRatios[resource.key]
	}));

	const currentResults = calculateResources({
		occupancy: snapshot.current_occupancy,
		as_of: snapshot.as_of,
		resources: currentResources
	});
	const scenarioResults = calculateResources({
		occupancy: parsedInput.occupancy,
		as_of: snapshot.as_of,
		resources: scenarioResources
	});

	const currentHorizon = projectHorizon(currentResults, parsedInput.days);
	const scenarioHorizon = projectHorizon(scenarioResults, parsedInput.days);

	return scenarioResultSchema.parse({
		input: parsedInput,
		snapshot,
		current: {
			occupancy: snapshot.current_occupancy,
			ratios: snapshot.current_ratios,
			daily_results: currentResults,
			horizon_results: currentHorizon
		},
		scenario: {
			occupancy: parsedInput.occupancy,
			ratios: scenarioRatios,
			daily_results: scenarioResults,
			horizon_results: scenarioHorizon
		},
		comparison: compareScenario(
			currentResults,
			scenarioResults,
			currentHorizon,
			scenarioHorizon,
			parsedInput.ratio_overrides
		)
	});
}

export const useRunSimulation = (shelterCode: () => string) =>
	createMutation(() => ({
		mutationFn: ({ input, snapshot }: RunSimulationRequest) =>
			runSimulation(input, shelterCode(), snapshot ? async () => snapshot : loadCalculationSnapshot)
	}));
