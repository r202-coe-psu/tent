import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';
import {
	dataStatusSchema,
	resourceCalcResultSchema,
	resourceKindSchema,
	type DataStatus,
	type ResourceCalcResult,
	type ResourceKind
} from '$lib/features/resource-calc';
import { SOP_RATIO_KEYS, type SopRatioKey } from '$lib/features/sop-ratios';
import {
	parseQty,
	persistQty,
	qtyStrSchema,
	qtyStrPositiveSchema,
	qtyStrNonNegativeSchema,
	subQty
} from '$lib/utils/qty';

const ratioOverrideShape = Object.fromEntries(
	SOP_RATIO_KEYS.map((key) => [key, qtyStrPositiveSchema.optional()])
) as Record<SopRatioKey, z.ZodOptional<typeof qtyStrPositiveSchema>>;

const fullRatioShape = Object.fromEntries(
	SOP_RATIO_KEYS.map((key) => [key, qtyStrPositiveSchema])
) as Record<SopRatioKey, typeof qtyStrPositiveSchema>;

export const scenarioRatioOverridesSchema = z.object(ratioOverrideShape).strict();
export const scenarioRatiosSchema = z.object(fullRatioShape).strict();

export const scenarioInputSchema = z
	.object({
		name: z.string().trim().min(1, 'กรุณาระบุชื่อสถานการณ์').max(120),
		occupancy: z.number().int().nonnegative(),
		days: z.number().int().min(1).max(365),
		ratio_overrides: scenarioRatioOverridesSchema
	})
	.strict();

export type RatioOverrides = Partial<Record<SopRatioKey, string>>;
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

export const calculationProfileSnapshotSchema = z
	.object({
		effective_id: z.string().min(1),
		effective_version: z.number().int().positive(),
		ratio_source: z.enum(['master', 'override']),
		base_profile_id: z.string().min(1).nullable(),
		override_id: z.string().min(1).nullable(),
		override_version: z.number().int().positive().nullable()
	})
	.strict()
	.superRefine((profile, ctx) => {
		if (profile.ratio_source === 'master') {
			if (
				profile.base_profile_id !== null ||
				profile.override_id !== null ||
				profile.override_version !== null
			) {
				ctx.addIssue({
					code: 'custom',
					message: 'Master provenance cannot contain override fields'
				});
			}
			return;
		}
		if (
			profile.base_profile_id === null ||
			profile.override_id === null ||
			profile.override_version === null
		) {
			ctx.addIssue({ code: 'custom', message: 'Override provenance is incomplete' });
		}
		if (
			profile.effective_id !== profile.override_id ||
			profile.effective_version !== profile.override_version
		) {
			ctx.addIssue({ code: 'custom', message: 'Effective override provenance does not match' });
		}
	});

export const scenarioResourceInputSchema = z
	.object({
		key: z.enum(SOP_RATIO_KEYS),
		kind: resourceKindSchema,
		ratio: qtyStrPositiveSchema,
		have: qtyStrNonNegativeSchema.nullable()
	})
	.strict();

export const calculationSnapshotSchema = z
	.object({
		shelter_code: shelterCodeSchema,
		as_of: z.string().datetime(),
		formula_v: z.string().min(1),
		profile: calculationProfileSnapshotSchema,
		current_occupancy: z.number().int().nonnegative(),
		current_ratios: scenarioRatiosSchema,
		resource_inputs: z.array(scenarioResourceInputSchema).length(SOP_RATIO_KEYS.length),
		stock_snapshot: z.record(z.string(), qtyStrNonNegativeSchema.nullable())
	})
	.strict()
	.superRefine((snapshot, ctx) => {
		for (const [index, key] of SOP_RATIO_KEYS.entries()) {
			const resource = snapshot.resource_inputs[index];
			if (!resource || resource.key !== key) {
				ctx.addIssue({
					code: 'custom',
					path: ['resource_inputs', index, 'key'],
					message: 'Resource inputs must use canonical order'
				});
				continue;
			}
			if (resource.ratio !== snapshot.current_ratios[key]) {
				ctx.addIssue({
					code: 'custom',
					path: ['resource_inputs', index, 'ratio'],
					message: 'Resource ratio must match the current ratio snapshot'
				});
			}
			if (resource.have !== snapshot.stock_snapshot[key]) {
				ctx.addIssue({
					code: 'custom',
					path: ['resource_inputs', index, 'have'],
					message: 'Resource availability must match the stock snapshot'
				});
			}
		}
	});

export type CalculationSnapshot = z.infer<typeof calculationSnapshotSchema>;

export const scenarioHorizonRowSchema = z
	.object({
		key: z.enum(SOP_RATIO_KEYS),
		kind: resourceKindSchema,
		daily_need: qtyStrNonNegativeSchema.nullable(),
		horizon_need: qtyStrNonNegativeSchema.nullable(),
		have: qtyStrNonNegativeSchema.nullable(),
		horizon_gap: qtyStrSchema.nullable()
	})
	.strict();

export interface ScenarioHorizonRow {
	key: SopRatioKey;
	kind: ResourceKind;
	daily_need: string | null;
	horizon_need: string | null;
	have: string | null;
	horizon_gap: string | null;
}

export const scenarioCalculationSchema = z
	.object({
		occupancy: z.number().int().nonnegative(),
		ratios: scenarioRatiosSchema,
		daily_results: z.array(resourceCalcResultSchema).length(SOP_RATIO_KEYS.length),
		horizon_results: z.array(scenarioHorizonRowSchema).length(SOP_RATIO_KEYS.length)
	})
	.strict();

export interface ScenarioCalculation {
	occupancy: number;
	ratios: Record<SopRatioKey, string>;
	daily_results: ResourceCalcResult[];
	horizon_results: ScenarioHorizonRow[];
}

export const scenarioComparisonRowSchema = z
	.object({
		key: z.enum(SOP_RATIO_KEYS),
		kind: resourceKindSchema,
		current_ratio: qtyStrPositiveSchema,
		scenario_ratio: qtyStrPositiveSchema,
		ratio_overridden: z.boolean(),
		current_daily_need: qtyStrNonNegativeSchema.nullable(),
		scenario_daily_need: qtyStrNonNegativeSchema.nullable(),
		current_horizon_need: qtyStrNonNegativeSchema.nullable(),
		scenario_horizon_need: qtyStrNonNegativeSchema.nullable(),
		have: qtyStrNonNegativeSchema.nullable(),
		current_horizon_gap: qtyStrSchema.nullable(),
		scenario_horizon_gap: qtyStrSchema.nullable(),
		need_delta: qtyStrSchema.nullable(),
		gap_delta: qtyStrSchema.nullable(),
		current_data_status: dataStatusSchema,
		scenario_data_status: dataStatusSchema
	})
	.strict();

export interface ScenarioComparisonRow {
	key: SopRatioKey;
	kind: ResourceKind;
	current_ratio: string;
	scenario_ratio: string;
	ratio_overridden: boolean;
	current_daily_need: string | null;
	scenario_daily_need: string | null;
	current_horizon_need: string | null;
	scenario_horizon_need: string | null;
	have: string | null;
	current_horizon_gap: string | null;
	scenario_horizon_gap: string | null;
	need_delta: string | null;
	gap_delta: string | null;
	current_data_status: DataStatus;
	scenario_data_status: DataStatus;
}

function projectedNeed(dailyNeed: string | null, kind: ResourceKind, days: number): string | null {
	if (dailyNeed === null || kind === 'threshold') return null;
	return kind === 'multiply' ? persistQty(parseQty(dailyNeed).mul(days)) : dailyNeed;
}

function projectedGap(
	horizonNeed: string | null,
	have: string | null,
	kind: ResourceKind
): string | null {
	if (kind === 'threshold' || horizonNeed === null || have === null) return null;
	return subQty(horizonNeed, have);
}

function difference(left: string | null, right: string | null): string | null {
	return left === null || right === null ? null : subQty(left, right);
}

export const scenarioResultSchema = z
	.object({
		input: scenarioInputSchema,
		snapshot: calculationSnapshotSchema,
		current: scenarioCalculationSchema,
		scenario: scenarioCalculationSchema,
		comparison: z.array(scenarioComparisonRowSchema).length(SOP_RATIO_KEYS.length)
	})
	.strict()
	.superRefine((result, ctx) => {
		if (result.current.occupancy !== result.snapshot.current_occupancy) {
			ctx.addIssue({
				code: 'custom',
				path: ['current', 'occupancy'],
				message: 'Current occupancy must match the input snapshot'
			});
		}
		if (result.scenario.occupancy !== result.input.occupancy) {
			ctx.addIssue({
				code: 'custom',
				path: ['scenario', 'occupancy'],
				message: 'Scenario occupancy must match scenario input'
			});
		}

		for (const [index, key] of SOP_RATIO_KEYS.entries()) {
			const currentRatio = result.snapshot.current_ratios[key];
			const scenarioRatio = result.input.ratio_overrides[key] ?? currentRatio;
			const resourceInput = result.snapshot.resource_inputs[index];
			const currentDaily = result.current.daily_results[index];
			const scenarioDaily = result.scenario.daily_results[index];
			const currentHorizon = result.current.horizon_results[index];
			const scenarioHorizon = result.scenario.horizon_results[index];
			const comparison = result.comparison[index];
			if (result.current.ratios[key] !== currentRatio) {
				ctx.addIssue({
					code: 'custom',
					path: ['current', 'ratios', key],
					message: 'Current ratio must match the input snapshot'
				});
			}
			if (result.scenario.ratios[key] !== scenarioRatio) {
				ctx.addIssue({
					code: 'custom',
					path: ['scenario', 'ratios', key],
					message: 'Scenario ratio must match the effective override'
				});
			}
			for (const [path, rows] of [
				[['current', 'daily_results'], result.current.daily_results],
				[['current', 'horizon_results'], result.current.horizon_results],
				[['scenario', 'daily_results'], result.scenario.daily_results],
				[['scenario', 'horizon_results'], result.scenario.horizon_results],
				[['comparison'], result.comparison]
			] as const) {
				if (rows[index]?.key !== key) {
					ctx.addIssue({
						code: 'custom',
						path: [...path, index, 'key'],
						message: 'Scenario result rows must use canonical order'
					});
				}
			}

			if (
				!resourceInput ||
				!currentDaily ||
				!scenarioDaily ||
				!currentHorizon ||
				!scenarioHorizon ||
				!comparison
			) {
				continue;
			}
			for (const [path, value, expected] of [
				[['current', 'daily_results', index, 'kind'], currentDaily.kind, resourceInput.kind],
				[['scenario', 'daily_results', index, 'kind'], scenarioDaily.kind, resourceInput.kind],
				[['current', 'horizon_results', index, 'kind'], currentHorizon.kind, resourceInput.kind],
				[['scenario', 'horizon_results', index, 'kind'], scenarioHorizon.kind, resourceInput.kind],
				[['comparison', index, 'kind'], comparison.kind, resourceInput.kind],
				[['current', 'daily_results', index, 'ratio'], currentDaily.ratio, currentRatio],
				[['scenario', 'daily_results', index, 'ratio'], scenarioDaily.ratio, scenarioRatio],
				[['current', 'daily_results', index, 'have'], currentDaily.have, resourceInput.have],
				[['scenario', 'daily_results', index, 'have'], scenarioDaily.have, resourceInput.have],
				[['current', 'daily_results', index, 'as_of'], currentDaily.as_of, result.snapshot.as_of],
				[['scenario', 'daily_results', index, 'as_of'], scenarioDaily.as_of, result.snapshot.as_of],
				[['comparison', index, 'current_ratio'], comparison.current_ratio, currentRatio],
				[['comparison', index, 'scenario_ratio'], comparison.scenario_ratio, scenarioRatio],
				[
					['comparison', index, 'current_daily_need'],
					comparison.current_daily_need,
					currentDaily.need
				],
				[
					['comparison', index, 'scenario_daily_need'],
					comparison.scenario_daily_need,
					scenarioDaily.need
				],
				[
					['comparison', index, 'current_horizon_need'],
					comparison.current_horizon_need,
					currentHorizon.horizon_need
				],
				[
					['comparison', index, 'scenario_horizon_need'],
					comparison.scenario_horizon_need,
					scenarioHorizon.horizon_need
				],
				[['comparison', index, 'have'], comparison.have, resourceInput.have],
				[
					['comparison', index, 'current_horizon_gap'],
					comparison.current_horizon_gap,
					currentHorizon.horizon_gap
				],
				[
					['comparison', index, 'scenario_horizon_gap'],
					comparison.scenario_horizon_gap,
					scenarioHorizon.horizon_gap
				],
				[
					['comparison', index, 'current_data_status'],
					comparison.current_data_status,
					currentDaily.data_status
				],
				[
					['comparison', index, 'scenario_data_status'],
					comparison.scenario_data_status,
					scenarioDaily.data_status
				]
			] as const) {
				if (value !== expected) {
					ctx.addIssue({
						code: 'custom',
						path: [...path],
						message: 'Scenario result is inconsistent with its frozen snapshot'
					});
				}
			}

			const expectedCurrentHorizonNeed = projectedNeed(
				currentDaily.need,
				resourceInput.kind,
				result.input.days
			);
			const expectedScenarioHorizonNeed = projectedNeed(
				scenarioDaily.need,
				resourceInput.kind,
				result.input.days
			);
			const expectedCurrentGap = projectedGap(
				expectedCurrentHorizonNeed,
				resourceInput.have,
				resourceInput.kind
			);
			const expectedScenarioGap = projectedGap(
				expectedScenarioHorizonNeed,
				resourceInput.have,
				resourceInput.kind
			);
			for (const [path, value, expected] of [
				[
					['current', 'horizon_results', index, 'daily_need'],
					currentHorizon.daily_need,
					currentDaily.need
				],
				[
					['scenario', 'horizon_results', index, 'daily_need'],
					scenarioHorizon.daily_need,
					scenarioDaily.need
				],
				[['current', 'horizon_results', index, 'have'], currentHorizon.have, resourceInput.have],
				[['scenario', 'horizon_results', index, 'have'], scenarioHorizon.have, resourceInput.have],
				[
					['current', 'horizon_results', index, 'horizon_need'],
					currentHorizon.horizon_need,
					expectedCurrentHorizonNeed
				],
				[
					['scenario', 'horizon_results', index, 'horizon_need'],
					scenarioHorizon.horizon_need,
					expectedScenarioHorizonNeed
				],
				[
					['current', 'horizon_results', index, 'horizon_gap'],
					currentHorizon.horizon_gap,
					expectedCurrentGap
				],
				[
					['scenario', 'horizon_results', index, 'horizon_gap'],
					scenarioHorizon.horizon_gap,
					expectedScenarioGap
				],
				[
					['comparison', index, 'need_delta'],
					comparison.need_delta,
					difference(expectedScenarioHorizonNeed, expectedCurrentHorizonNeed)
				],
				[
					['comparison', index, 'gap_delta'],
					comparison.gap_delta,
					difference(expectedScenarioGap, expectedCurrentGap)
				]
			] as const) {
				if (value !== expected) {
					ctx.addIssue({
						code: 'custom',
						path: [...path],
						message: 'Scenario projection is inconsistent with its frozen snapshot'
					});
				}
			}
			if (comparison.ratio_overridden !== (result.input.ratio_overrides[key] !== undefined)) {
				ctx.addIssue({
					code: 'custom',
					path: ['comparison', index, 'ratio_overridden'],
					message: 'Ratio override marker does not match scenario input'
				});
			}
		}
	});

export interface ScenarioResult {
	input: ScenarioInput;
	snapshot: CalculationSnapshot;
	current: ScenarioCalculation;
	scenario: ScenarioCalculation;
	comparison: ScenarioComparisonRow[];
}

export const SCENARIO_SCHEMA_VERSION = 1;

export const scenarioSchema = z
	.object({
		_id: z.string().regex(/^simulation:[0-9A-HJKMNP-TV-Z]{26}$/),
		_rev: z.string().optional(),
		type: z.literal('simulation'),
		schema_v: z.literal(SCENARIO_SCHEMA_VERSION),
		shelter_code: shelterCodeSchema,
		created_at: z.string().datetime(),
		updated_at: z.string().datetime(),
		created_by: z.string().min(1),
		result: scenarioResultSchema
	})
	.strict()
	.superRefine((scenario, ctx) => {
		if (scenario.shelter_code !== scenario.result.snapshot.shelter_code) {
			ctx.addIssue({
				code: 'custom',
				path: ['result', 'snapshot', 'shelter_code'],
				message: 'Scenario snapshot shelter must match the document shelter'
			});
		}
		if (scenario.created_at !== scenario.updated_at) {
			ctx.addIssue({
				code: 'custom',
				path: ['updated_at'],
				message: 'Immutable scenario timestamps must match'
			});
		}
	});

export type Scenario = z.infer<typeof scenarioSchema>;

export const isScenario = (value: unknown): value is Scenario =>
	scenarioSchema.safeParse(value).success;
