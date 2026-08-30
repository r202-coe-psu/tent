export {
	scenarioInputSchema,
	scenarioResultSchema,
	scenarioSchema,
	SCENARIO_SCHEMA_VERSION,
	type RatioOverrides,
	type ScenarioInput,
	type ScenarioResult,
	type ScenarioComparisonRow,
	type CalculationSnapshot,
	type Scenario
} from './domain/scenario.schema';
export { projectHorizon, compareScenario } from './domain/scenario.projection';
export {
	runSimulation,
	useRunSimulation,
	type RunSimulationRequest
} from './application/use-run-simulation';
export {
	scenarioKeys,
	useScenarios,
	useScenario,
	useOpenScenario,
	useSaveScenario,
	useCurrentCalculationSnapshot
} from './application/queries';
export {
	type ScenarioRepository,
	type ScenarioSummary,
	type ScenarioPage,
	SCENARIO_ID_PREFIX
} from './data/scenario.repository';
export { ScenarioRemoteRepository, scenarioRepository } from './data/scenario.remote';
export { default as ScenarioWorkspace } from './ui/scenario-workspace.svelte';
