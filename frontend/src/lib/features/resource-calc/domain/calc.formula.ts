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

import { persistQty } from '$lib/utils/qty';
import Decimal from 'decimal.js';

/**
 * ALGORITHM/formula version (semver) — NOT an API or schema version.
 * Semver governance (what counts as major/minor/patch) lives in the ADR, not here.
 * NOTE: changing quantity rounding ({@link persistQty}) alters observable `status`
 * classification and is therefore a FORMULA_V-governed formula change, not silent tuning.
 *
 * 2.0.0 (CR-038) — migrate all ratio, have, need, and gap fields to decimal strings (string)
 *                 and perform all resource-calc math using decimal.js.
 */
export const FORMULA_V = '2.0.0';

/** Opaque resource id. Non-empty & unique are caller invariants (engine does not validate). */
export type ResourceKey = string;

export type ResourceKind = 'multiply' | 'divide' | 'threshold';

/** BUSINESS outcome only — no validation/runtime states here (see the truth table in the plan). */
export type ResourceStatus = 'ok' | 'gap' | 'surplus' | 'constraint' | 'insufficient_data';

/**
 * DATA-AVAILABILITY axis only — answers "was full computation possible?", orthogonal to the
 * business `status`. Set purely from input availability + computational validity (ratio/have
 * presence, structural validity, overflow); NEVER from the business outcome (the sign/magnitude of
 * `gap`/`need` or the `status` value) — a valid computation yielding a huge gap is still `complete`.
 *
 * NOT exhaustive of business situations: valid business facts like `occupancy = 0` / `stock = 0` are
 * successful computations and stay `complete` — do NOT add values like `zero_occupancy`/`stock_zero`
 * here (that would recreate the axis-mixing this discriminator avoids; they are already derivable
 * from `need`/`have`/`gap`). `invalid_input` intentionally mirrors `!input_valid` — the two must
 * evolve together under FORMULA_V.
 */
export type DataStatus =
	| 'complete' // no data-availability issue occurred (NOT "business goal achieved" — that is `status: 'ok'`)
	| 'ratio_missing' // ratio not provided for this item → cannot compute need
	| 'stock_unsynced' // have === null → cannot compute gap
	| 'invalid_input'; // structurally bad datum / overflow (=== !input_valid)

/** One resolved resource line — the caller supplies kind + ratio + have. */
export interface ResourceInput {
	readonly key: ResourceKey;
	readonly kind: ResourceKind;
	/** Effective ratio, already resolved upstream. */
	readonly ratio: string | null;
	/** Available quantity (`null` = unknown / not synced). */
	readonly have: string | null;
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
	readonly ratio: string | null;
	/** multiply: occupancy×ratio · divide: ceil(occupancy/ratio) · threshold/overflow/invalid: null. */
	readonly need: string | null;
	/** Echoed for ALL kinds; for threshold it is INFORMATIONAL only — never affects `status`. */
	readonly have: string | null;
	/** `need − have`, rounded to quantity decimals; null for threshold/overflow/no-verdict. */
	readonly gap: string | null;
	readonly status: ResourceStatus;
	/** Data-availability axis (orthogonal to `status`). Tells *why* a row is `insufficient_data`. */
	readonly data_status: DataStatus;
	readonly as_of: string;
}

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
	return {
		...base,
		input_valid: false,
		need: null,
		gap: null,
		status: 'insufficient_data',
		data_status: 'invalid_input'
	};
}

function calcRow(
	occupancy: number,
	r: ResourceInput,
	ordinal: number,
	as_of: string
): ResourceCalcResult {
	const base = { ordinal, key: r.key, kind: r.kind, ratio: r.ratio, have: r.have, as_of };

	const occupancyValid = Number.isFinite(occupancy) && occupancy >= 0;

	let ratioBad = false;
	if (r.ratio != null) {
		try {
			const dec = new Decimal(r.ratio);
			if (dec.isNaN() || !dec.isFinite() || dec.lte(0)) {
				ratioBad = true;
			}
		} catch {
			ratioBad = true;
		}
	}

	let haveBad = false;
	if (r.have != null) {
		try {
			const dec = new Decimal(r.have);
			if (dec.isNaN() || !dec.isFinite() || dec.lt(0)) {
				haveBad = true;
			}
		} catch {
			haveBad = true;
		}
	}

	// 1. Validity gate — structurally bad input (occupancy shared, so an invalid occupancy
	//    invalidates every row). Runs BEFORE kind semantics: `ratio=-5` on a threshold is invalid.
	if (!occupancyValid || ratioBad || haveBad) {
		return invalidResult(base);
	}

	// 2. Absent data — ratio simply not provided yet (nothing wrong, just missing).
	if (r.ratio == null) {
		return {
			...base,
			input_valid: true,
			need: null,
			gap: null,
			status: 'insufficient_data',
			data_status: 'ratio_missing'
		};
	}

	// 3. Kind semantics (ratio valid & present; occupancy valid).
	let need: string;
	switch (r.kind) {
		case 'threshold':
			// Quality ceiling, not a quantity. `have`/`ratio` echoed but never affect status.
			return {
				...base,
				input_valid: true,
				need: null,
				gap: null,
				status: 'constraint',
				data_status: 'complete'
			};
		case 'multiply': {
			try {
				const dRatio = new Decimal(r.ratio);
				need = persistQty(dRatio.mul(occupancy));
			} catch {
				return invalidResult(base);
			}
			break;
		}
		case 'divide': {
			try {
				const dRatio = new Decimal(r.ratio);
				need = new Decimal(occupancy).div(dRatio).ceil().toString();
			} catch {
				return invalidResult(base);
			}
			break;
		}
		default:
			return assertNever(r.kind);
	}

	// Overflow guard (multiply AND divide, e.g. ceil(1e308 / 1e-308)) — never leak Infinity.
	try {
		const dNeed = new Decimal(need);
		if (!dNeed.isFinite() || dNeed.isNaN() || dNeed.abs().gt(Number.MAX_VALUE)) {
			return invalidResult(base);
		}
	} catch {
		return invalidResult(base);
	}

	if (r.have == null) {
		return {
			...base,
			input_valid: true,
			need,
			gap: null,
			status: 'insufficient_data',
			data_status: 'stock_unsynced'
		};
	}

	let gap: string;
	let status: ResourceStatus;
	try {
		const dNeed = new Decimal(need);
		const dHave = new Decimal(r.have);
		const dGap = dNeed.sub(dHave);
		gap = persistQty(dGap);

		if (dGap.gt(0)) {
			status = 'gap';
		} else if (dGap.lt(0)) {
			status = 'surplus';
		} else {
			status = 'ok';
		}
	} catch {
		return invalidResult(base);
	}

	// Gap computed successfully — incl. valid occupancy=0 (need 0) and stock=0 (have 0) rows.
	return { ...base, input_valid: true, need, gap, status, data_status: 'complete' };
}

/**
 * Pure. Assumes the caller has ALREADY resolved `ratio`, `kind`, and `have` (e.g.
 * resolveEffectiveProfile + SOP_RATIO_KIND + stock/facilities). It does NOT load or resolve profiles.
 *
 * Duplicate `key`s are preserved 1:1 (dedup belongs to the adapter). Pair results back by `ordinal`.
 *
 * Decimal String arithmetic: `need`/`gap` are computed using decimal.js and returned as
 * decimal strings to avoid IEEE-754 precision issues.
 *
 * Never throws on data problems (reports via `input_valid` + `status`); throws only via `assertNever`.
 */
export function calculateResources(input: CalcInput): ResourceCalcResult[] {
	return input.resources.map((r, i) => calcRow(input.occupancy, r, i, input.as_of));
}
