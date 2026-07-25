/**
 * T-31.2 — domain Zod schemas + snapshot types for the resource-calc feature.
 *
 * These schemas MIRROR the TypeScript interfaces in `calc.formula.ts` (T-31.1) 1:1 for
 * runtime type validation, plus the `DailyCalcDoc` snapshot envelope that freezes every
 * input used at calc time (ratio / occupancy / stock / version) so a persisted result is
 * reproducible even after the live profile / occupancy / stock change.
 *
 * SNAPSHOT & VERSION LOCK: each field freezes an input used at calc time so a persisted
 * result is reproducible (see `dailyCalcDocSchema`). Immutability (re-calc = new doc, never
 * mutate) is a data-layer rule, not enforced here.
 *
 * DECISION — `ratio_snapshot` / `stock_snapshot` keys stay GENERIC `string`, NOT constrained
 * to `SOP_RATIO_KEYS`. Rationale: (1) the engine (`calc.formula.ts`) is deliberately
 * domain-agnostic — it "does NOT import sop-ratios" and uses `ResourceKey = string`;
 * (2) constraining here would couple resource-calc/domain to sop-ratios/domain across feature
 * boundaries; (3) resources span more than the 20 SOP keys (food ingredients, stock items,
 * facilities, volunteers). Keys align with SOP ratio names when ratios come from T-30, but the
 * schema does not require it.
 *
 * This file is domain-only: it does NOT persist, touch schema.md, or define a CouchDB doc type
 * (persisting `DailyCalcDoc` needs a CR — change-management §2).
 */

import { z } from 'zod';
import { qtyStrSchema, qtyStrPositiveSchema, qtyStrNonNegativeSchema } from '$lib/utils/qty';

// --- Enums (mirror calc.formula.ts ResourceKind / ResourceStatus / DataStatus) ---
export const resourceKindSchema = z.enum(['multiply', 'divide', 'threshold']);
export const resourceStatusSchema = z.enum([
	'ok',
	'gap',
	'surplus',
	'constraint',
	'insufficient_data'
]);
/** Data-availability axis (T-31.3, added on FORMULA_V 1.1.0) — orthogonal to `status`. */
export const dataStatusSchema = z.enum([
	'complete',
	'ratio_missing',
	'stock_unsynced',
	'invalid_input'
]);

/**
 * Mirror of `ResourceInput` (calc.formula.ts). `.finite()` states the formula's
 * `Number.isFinite` gate explicitly (Zod's `z.number()` already rejects `NaN` AND `±Infinity`);
 * `.positive()`/`.nonnegative()` are the documented CALLER INVARIANTS.
 *
 * BOUNDARY vs DEFENSIVE: this schema is the input-VALIDATION BOUNDARY — it rejects
 * `ratio <= 0` / non-finite / `have < 0` up front. `calculateResources()` is independently
 * DEFENSIVE (it accepts such values and reports `input_valid: false` instead of throwing), so
 * the two have intentionally different acceptance sets: a caller that validates here first will
 * never reach the formula's invalid-input branches. Keep both — schema = contract enforcement,
 * formula = last-line safety for unchecked callers.
 */
export const resourceInputSchema = z.object({
	key: z.string().min(1),
	kind: resourceKindSchema,
	ratio: qtyStrPositiveSchema.nullable(),
	have: qtyStrNonNegativeSchema.nullable()
});
export type ResourceInputParsed = z.infer<typeof resourceInputSchema>;

/** Mirror of `CalcInput` (calc.formula.ts). `as_of` = ISO-8601 UTC (caller invariant). */
export const calcInputSchema = z.object({
	occupancy: z.number().finite().nonnegative(),
	as_of: z.string().datetime(),
	resources: z.array(resourceInputSchema)
});
export type CalcInputParsed = z.infer<typeof calcInputSchema>;

/**
 * Mirror of `ResourceCalcResult` (calc.formula.ts).
 *
 * FINITENESS: all numeric fields are `.finite()`. Note this is already the default — Zod's
 * `z.number()` rejects both `NaN` AND `±Infinity` — so `.finite()` is explicit intent, not a
 * behavioural change. `need` / `gap` are always finite-or-null (the formula's overflow guard
 * returns `null`). `ratio` / `have` are echoed inputs: for a result produced from a
 * `resourceInputSchema`-validated `CalcInput` they are always finite; a caller that bypasses
 * input validation and feeds `±Infinity` to `calculateResources()` yields a row whose echoed
 * `ratio`/`have` will NOT round-trip here — acceptable, since finite input is the documented
 * `ResourceInput` contract.
 *
 * `.strict()` — no unknown keys. This is what makes the round-trip test a real drift detector:
 * if the formula adds a field and this schema is not updated, `.strict()` fails instead of
 * silently stripping it.
 */
export const resourceCalcResultSchema = z
	.object({
		ordinal: z.number().int().nonnegative(),
		key: z.string().min(1),
		kind: resourceKindSchema,
		input_valid: z.boolean(),
		ratio: qtyStrPositiveSchema.nullable(),
		need: qtyStrNonNegativeSchema.nullable(),
		have: qtyStrNonNegativeSchema.nullable(),
		gap: qtyStrSchema.nullable(),
		status: resourceStatusSchema,
		data_status: dataStatusSchema,
		as_of: z.string().datetime()
	})
	.strict();
export type ResourceCalcResultParsed = z.infer<typeof resourceCalcResultSchema>;

/**
 * CalcOutput = the formula's result rows plus the algorithm version that produced them.
 * `calculateResources` returns the raw `ResourceCalcResult[]`; the caller wraps it with
 * `formula_v` to form this output envelope. `formula_v` is a free `string` (not pinned to a
 * literal) so an older output that recorded a previous `FORMULA_V` still validates.
 */
export const calcOutputSchema = z.object({
	formula_v: z.string().min(1),
	results: z.array(resourceCalcResultSchema)
});
export type CalcOutput = z.infer<typeof calcOutputSchema>;

/**
 * DailyCalcDoc — the snapshot-locked record. Every field freezes an input used at calc time so
 * the stored result is reproducible. All six snapshot fields are required.
 * - `formula_v` / `sop_profile_version` = the two version-lock axes (algorithm + ratio source).
 * - `ratio_snapshot` / `stock_snapshot` keyed by generic `string` (see the DECISION in the file
 *   header — deliberately NOT constrained to `SOP_RATIO_KEYS`). An EMPTY `{}` is intentionally
 *   accepted — a calc with no resources still records occupancy/version. Values are `.finite()`
 *   (a snapshot never stores `±Infinity`); stock values may be `null` (unsynced).
 * - immutability (re-calc = new doc, never mutate) is a data-layer rule, not enforced here.
 */
export const DAILY_CALC_SCHEMA_VERSION = 2;
export const dailyCalcDocSchema = z.object({
	formula_v: z.string().min(1),
	sop_profile_version: z.number().int().positive(),
	ratio_snapshot: z.record(z.string(), qtyStrPositiveSchema),
	occupancy_snapshot: z.number().finite().nonnegative(),
	as_of: z.string().datetime(),
	stock_snapshot: z.record(z.string(), qtyStrNonNegativeSchema.nullable()),
	results: z.array(resourceCalcResultSchema)
});
export type DailyCalcDoc = z.infer<typeof dailyCalcDocSchema>;
