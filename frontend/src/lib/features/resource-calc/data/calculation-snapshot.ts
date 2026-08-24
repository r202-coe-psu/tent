/**
 * Shared read-only input boundary for T-31 daily calculation and T-42 simulation.
 * It resolves every live source once and returns the exact immutable values fed to the engine.
 */
import { now } from '$lib/db/model';
import { peopleRepository, type Evacuee } from '$lib/features/people';
import { operationsRepository } from '$lib/features/operations';
import { sheltersRepository } from '$lib/features/shelters';
import {
	getActiveSopProfile,
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	type SopMaster,
	type SopOverride,
	type SopRatioKey
} from '$lib/features/sop-ratios';
import { FORMULA_V, type ResourceInput } from '../domain/calc.formula';
import { resolveHave, type ShelterHaveSource } from './have-map';

export interface CalculationProfileSnapshot {
	effective_id: string;
	effective_version: number;
	ratio_source: 'master' | 'override';
	base_profile_id: string | null;
	override_id: string | null;
	override_version: number | null;
}

export interface CalculationSnapshot {
	shelter_code: string;
	as_of: string;
	formula_v: string;
	profile: CalculationProfileSnapshot;
	current_occupancy: number;
	current_ratios: Record<SopRatioKey, string>;
	resource_inputs: ResourceInput[];
	stock_snapshot: Record<string, string | null>;
}

/** Count evacuees physically present in the shelter. */
export function countActive(evacuees: Evacuee[]): number {
	return evacuees.filter((evacuee) => evacuee.current_stay?.status === 'active').length;
}

function profileSnapshot(active: SopMaster | SopOverride): CalculationProfileSnapshot {
	if (active.type === 'sop_override') {
		return {
			effective_id: active._id,
			effective_version: active.version,
			ratio_source: 'override',
			base_profile_id: active.base_profile_id,
			override_id: active._id,
			override_version: active.version
		};
	}
	return {
		effective_id: active._id,
		effective_version: active.version,
		ratio_source: 'master',
		base_profile_id: null,
		override_id: null,
		override_version: null
	};
}

export function buildCalculationResources(
	ratios: Record<SopRatioKey, string>,
	stock: Map<string, string>,
	shelter: ShelterHaveSource
): { resource_inputs: ResourceInput[]; stock_snapshot: Record<string, string | null> } {
	const resourceInputs: ResourceInput[] = [];
	const stockSnapshot: Record<string, string | null> = {};

	for (const key of SOP_RATIO_KEYS) {
		const have = resolveHave(key, { stock, shelter });
		resourceInputs.push({ key, kind: SOP_RATIO_KIND[key], ratio: ratios[key], have });
		stockSnapshot[key] = have;
	}

	return { resource_inputs: resourceInputs, stock_snapshot: stockSnapshot };
}

/** Load the current calculation inputs exactly once. This function never persists data. */
export async function loadCalculationSnapshot(shelterCode: string): Promise<CalculationSnapshot> {
	const [evacuees, active, stock, shelter] = await Promise.all([
		peopleRepository(shelterCode).listEvacuees(),
		getActiveSopProfile(shelterCode),
		operationsRepository(shelterCode).getBalance(),
		sheltersRepository().getShelter(shelterCode)
	]);

	if (!active) {
		throw new Error('No active SOP profile for this shelter');
	}

	const currentRatios = { ...active.ratios } as Record<SopRatioKey, string>;
	const resources = buildCalculationResources(currentRatios, stock, shelter);

	const completedAt = now();
	return {
		shelter_code: shelterCode,
		as_of: completedAt,
		formula_v: FORMULA_V,
		profile: profileSnapshot(active),
		current_occupancy: countActive(evacuees),
		current_ratios: currentRatios,
		resource_inputs: resources.resource_inputs.map((resource) => ({ ...resource })),
		stock_snapshot: { ...resources.stock_snapshot }
	};
}
