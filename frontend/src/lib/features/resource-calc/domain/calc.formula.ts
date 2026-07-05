/**
 * T-31.1 — Daily resource calculation engine, pure formula.
 *
 * `calculateResources(occupancy, resources, as_of) → ResourceCalcResult[]`.
 * A generic, self-contained engine: it does NOT import `sop-ratios`, iterate any
 * external constant, do I/O, or read the clock. Output depends only on `input`.
 *
 * The caller resolves each resource upstream (effective ratio + kind + available
 * quantity) and passes them in; the engine is domain-agnostic and reusable.
 */

/**
 * ALGORITHM/formula version (semver) — NOT an API or schema version.
 * Semver governance (what counts as major/minor/patch) lives in the ADR, not here.
 * NOTE: changing `GAP_EPSILON` alters observable `status` classification and is
 * therefore a FORMULA_V-governed formula change, not silent tuning.
 */
export const FORMULA_V = '1.0.0';

/** Opaque resource id. Non-empty & unique are caller invariants (engine does not validate). */
export type ResourceKey = string;

export type ResourceKind = 'multiply' | 'divide' | 'threshold';

/** BUSINESS outcome only — no validation/runtime states here (see the truth table in the plan). */
export type ResourceStatus = 'ok' | 'gap' | 'surplus' | 'constraint' | 'insufficient_data';

/** One resolved resource line — the caller supplies kind + ratio + have. */
export interface ResourceInput {
	readonly key: ResourceKey;
	readonly kind: ResourceKind;
	/** Effective ratio, already resolved upstream. */
	readonly ratio: number | null;
	/** Available quantity (`null` = unknown / not synced). */
	readonly have: number | null;
}

export interface CalcInput {
	readonly occupancy: number;
	/** Caller invariant: ISO-8601 / RFC3339 UTC. Carried through verbatim — NOT parsed/validated. */
	readonly as_of: string;
	readonly resources: ReadonlyArray<ResourceInput>;
}

export interface ResourceCalcResult {
	/** Index in `input.resources` — stable ONLY within one invocation (not a persistent id). */
	readonly ordinal: number;
	readonly key: ResourceKey;
	readonly kind: ResourceKind;
	/** `false` = a datum this row needs is structurally bad (occupancy<0, ratio≤0/NaN, have<0/NaN, overflow). */
	readonly input_valid: boolean;
	/** Echoed for ALL kinds incl. threshold. */
	readonly ratio: number | null;
	/** multiply: occupancy×ratio · divide: ceil(occupancy/ratio) · threshold/overflow/invalid: null. */
	readonly need: number | null;
	/** Echoed for ALL kinds; for threshold it is INFORMATIONAL only — never affects `status`. */
	readonly have: number | null;
	/** RAW `need − have`; null for threshold/overflow/no-verdict. Sign→status uses `GAP_EPSILON`, not `===`. */
	readonly gap: number | null;
	readonly status: ResourceStatus;
	readonly as_of: string;
}

/**
 * Absolute tolerance for gap→status classification. Raw numeric fields are NOT rounded.
 *
 * This exists ONLY to suppress IEEE-754 representation noise (e.g. `3 * 0.1 - 0.3 !== 0`) —
 * it is deliberately absolute, not scaled to magnitude, because a relative/scaled tolerance
 * would silently absorb genuinely meaningful shortfalls at large quantities. Any change from
 * an absolute tolerance to a relative/scaled tolerance is a business-rule change and therefore
 * belongs to `FORMULA_V`, not a numerical-analysis tweak.
 */
const GAP_EPSILON = 1e-9;

/**
 * Exhaustiveness guard. Compile-time: adding a `ResourceKind` fails to type-check here.
 * Runtime: a `kind` forced in via cast throws (programming error, not a data problem —
 * "Unhandled", not "unreachable", because a cast *can* reach it).
 */
function assertNever(x: never): never {
	throw new Error('Unhandled ResourceKind: ' + String(x));
}

/** Shared shape for "structurally invalid input" — used by both the validity gate and the overflow guard. */
function invalidResult(
	base: Pick<ResourceCalcResult, 'ordinal' | 'key' | 'kind' | 'ratio' | 'have' | 'as_of'>
): ResourceCalcResult {
	return { ...base, input_valid: false, need: null, gap: null, status: 'insufficient_data' };
}

function calcRow(
	occupancy: number,
	r: ResourceInput,
	ordinal: number,
	as_of: string
): ResourceCalcResult {
	const base = { ordinal, key: r.key, kind: r.kind, ratio: r.ratio, have: r.have, as_of };

	const occupancyValid = Number.isFinite(occupancy) && occupancy >= 0;
	const ratioBad = r.ratio != null && (!Number.isFinite(r.ratio) || r.ratio <= 0);
	const haveBad = r.have != null && (!Number.isFinite(r.have) || r.have < 0);

	// 1. Validity gate — structurally bad input (occupancy shared, so an invalid occupancy
	//    invalidates every row). Runs BEFORE kind semantics: `ratio=-5` on a threshold is invalid.
	if (!occupancyValid || ratioBad || haveBad) {
		return invalidResult(base);
	}

	// 2. Absent data — ratio simply not provided yet (nothing wrong, just missing).
	if (r.ratio == null) {
		return { ...base, input_valid: true, need: null, gap: null, status: 'insufficient_data' };
	}

	// 3. Kind semantics (ratio valid & present; occupancy valid).
	let need: number;
	switch (r.kind) {
		case 'threshold':
			// Quality ceiling, not a quantity. `have`/`ratio` echoed but never affect status.
			return { ...base, input_valid: true, need: null, gap: null, status: 'constraint' };
		case 'multiply':
			need = occupancy * r.ratio;
			break;
		case 'divide':
			need = Math.ceil(occupancy / r.ratio);
			break;
		default:
			return assertNever(r.kind);
	}

	// Overflow guard (multiply AND divide, e.g. ceil(1e308 / 1e-308)) — never leak Infinity.
	if (!Number.isFinite(need)) {
		return invalidResult(base);
	}

	if (r.have == null) {
		return { ...base, input_valid: true, need, gap: null, status: 'insufficient_data' };
	}

	const gap = need - r.have;
	let status: ResourceStatus;
	if (gap > GAP_EPSILON) status = 'gap';
	else if (gap < -GAP_EPSILON) status = 'surplus';
	else status = 'ok';

	return { ...base, input_valid: true, need, gap, status };
}

/**
 * Pure. Assumes the caller has ALREADY resolved `ratio`, `kind`, and `have` (e.g.
 * resolveEffectiveProfile + SOP_RATIO_KIND + stock/facilities). It does NOT load or resolve profiles.
 *
 * Duplicate `key`s are preserved 1:1 (dedup belongs to the adapter). Pair results back by `ordinal`.
 *
 * Floating point: `need`/`gap` are RAW — precision is delegated to the presentation layer; consumers
 * MUST NOT compare them with `===`. `status` already absorbs float noise via `GAP_EPSILON`.
 *
 * Never throws on data problems (reports via `input_valid` + `status`); throws only via `assertNever`.
 */
export function calculateResources(input: CalcInput): ResourceCalcResult[] {
	return input.resources.map((r, i) => calcRow(input.occupancy, r, i, input.as_of));
}
