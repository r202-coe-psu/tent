import Decimal from 'decimal.js';
import { persistQty } from '$lib/utils/qty';
import type { ResourceCalcResult } from '$lib/features/resource-calc';
import type { SopRatioKey } from '$lib/features/sop-ratios';
import type { RatioOverrides, ScenarioComparisonRow, ScenarioHorizonRow } from './scenario.schema';

function difference(left: string | null, right: string | null): string | null {
	if (left === null || right === null) return null;
	return persistQty(new Decimal(left).sub(right));
}

export function projectHorizon(
	results: readonly ResourceCalcResult[],
	days: number
): ScenarioHorizonRow[] {
	return results.map((result) => {
		const key = result.key as SopRatioKey;
		if (result.kind === 'threshold') {
			return {
				key,
				kind: result.kind,
				daily_need: result.need,
				horizon_need: null,
				have: result.have,
				horizon_gap: null
			};
		}

		const horizonNeed =
			result.need === null
				? null
				: result.kind === 'multiply'
					? persistQty(new Decimal(result.need).mul(days))
					: result.need;

		return {
			key,
			kind: result.kind,
			daily_need: result.need,
			horizon_need: horizonNeed,
			have: result.have,
			horizon_gap: difference(horizonNeed, result.have)
		};
	});
}

export function compareScenario(
	currentResults: readonly ResourceCalcResult[],
	scenarioResults: readonly ResourceCalcResult[],
	currentHorizon: readonly ScenarioHorizonRow[],
	scenarioHorizon: readonly ScenarioHorizonRow[],
	overrides: RatioOverrides
): ScenarioComparisonRow[] {
	if (
		currentResults.length !== scenarioResults.length ||
		currentResults.length !== currentHorizon.length ||
		currentResults.length !== scenarioHorizon.length
	) {
		throw new Error('T-31 result contract mismatch');
	}

	return currentResults.map((current, index) => {
		const scenario = scenarioResults[index];
		const currentProjected = currentHorizon[index];
		const scenarioProjected = scenarioHorizon[index];
		if (
			!scenario ||
			!currentProjected ||
			!scenarioProjected ||
			current.ordinal !== scenario.ordinal ||
			current.key !== scenario.key ||
			current.key !== currentProjected.key ||
			current.key !== scenarioProjected.key
		) {
			throw new Error('T-31 result contract mismatch');
		}

		const key = current.key as SopRatioKey;
		if (current.ratio === null || scenario.ratio === null) {
			throw new Error(`T-31 returned a missing ratio for ${key}`);
		}

		return {
			key,
			kind: current.kind,
			current_ratio: current.ratio,
			scenario_ratio: scenario.ratio,
			ratio_overridden: overrides[key] !== undefined,
			current_daily_need: current.need,
			scenario_daily_need: scenario.need,
			current_horizon_need: currentProjected.horizon_need,
			scenario_horizon_need: scenarioProjected.horizon_need,
			have: current.have,
			current_horizon_gap: currentProjected.horizon_gap,
			scenario_horizon_gap: scenarioProjected.horizon_gap,
			need_delta: difference(scenarioProjected.horizon_need, currentProjected.horizon_need),
			gap_delta: difference(scenarioProjected.horizon_gap, currentProjected.horizon_gap),
			current_data_status: current.data_status,
			scenario_data_status: scenario.data_status
		};
	});
}
