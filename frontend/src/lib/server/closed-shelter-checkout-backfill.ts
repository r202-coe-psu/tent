/**
 * Pure planning for the closed-shelter checkout backfill (CR-219 FR-28..FR-31, D-8).
 *
 * Free of `$env`, `@sveltejs/kit` and I/O so `scripts/migrate-closed-shelter-checkout.ts` runs under
 * plain `tsx` and this logic is unit-testable. The heavy lifting (checking people out) is
 * `closeShelterPeople`; this module only picks the shelters, parses the CLI and builds the
 * per-shelter summary audit. Backfill never writes the registry (FR-29).
 */

import type { AuthorContext } from '$lib/db/model';
// The shared barrel re-exports .svelte components, which plain `tsx` (the migrate script) cannot load.
// eslint-disable-next-line no-restricted-imports
import { createAuditEntry, type AuditEntry } from '$lib/features/shared/domain/audit';
import { resolveOperationStatus } from '$lib/features/shelters/server';
import type { ShelterCloseRun } from './shelter-close';

/** Author stamped on every movement / audit the backfill writes. */
export const BACKFILL_CREATED_BY = 'system:migrate-closed-shelter-checkout';
/** FR-30: context merged into the per-household cancel audits too. */
export const BACKFILL_AUDIT_CONTEXT = { backfill: true } as const;
export const SHELTER_CLOSED_REASON = 'shelter_closed';

export type BackfillMode = 'dry-run' | 'write';

export type BackfillArgs =
	{ ok: true; mode: BackfillMode; shelter: string | null } | { ok: false; error: string };

/**
 * `--dry-run` is the default (counts only). `--write --confirm` applies, matching the other
 * one-off scripts; `--shelter <code>` / `--shelter=<code>` limits the run to one shelter.
 */
export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
	let write = false;
	let confirm = false;
	let dryRun = false;
	let shelter: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--write') write = true;
		else if (arg === '--confirm') confirm = true;
		else if (arg === '--dry-run') dryRun = true;
		else if (arg === '--shelter' || arg.startsWith('--shelter=')) {
			const value = arg === '--shelter' ? argv[++i] : arg.slice('--shelter='.length);
			if (!value || value.startsWith('--')) return { ok: false, error: '--shelter needs a code' };
			shelter = value.trim();
		} else return { ok: false, error: `unknown argument: ${arg}` };
	}
	if (write && dryRun) return { ok: false, error: '--dry-run and --write cannot be combined' };
	if (write && !confirm) {
		return { ok: false, error: '--write requires --confirm (a typo could write to production)' };
	}
	if (confirm && !write) return { ok: false, error: '--confirm only applies with --write' };
	return { ok: true, mode: write ? 'write' : 'dry-run', shelter };
}

export interface ClosedShelterTarget {
	code: string;
	/** Registry `closed_at`, kept only for the audit — never rewritten (FR-29). Null when unset. */
	closed_at: string | null;
}

export type ClosedShelterSelection =
	{ ok: true; shelters: ClosedShelterTarget[] } | { ok: false; error: string };

function shelterCode(doc: Record<string, unknown>): string | null {
	if (typeof doc.code === 'string' && doc.code.trim()) return doc.code.trim();
	return null;
}

/**
 * Registry shelters whose `operation_status` resolves to `closed` (FR-28). With `only`, exactly
 * that shelter (case-insensitive) — an error when it is missing or not closed.
 */
export function selectClosedShelters(
	docs: readonly Record<string, unknown>[],
	only: string | null = null
): ClosedShelterSelection {
	const all = docs
		.filter((d) => d.type === 'shelter' && shelterCode(d))
		.map((d) => ({ doc: d, code: shelterCode(d)! }));
	const byCode = new Map<string, { doc: Record<string, unknown>; code: string }>();
	for (const entry of all) byCode.set(entry.code.toUpperCase(), entry);

	if (only !== null) {
		const entry = byCode.get(only.toUpperCase());
		if (!entry) return { ok: false, error: `shelter ${only} not found in the registry` };
		const status = resolveOperationStatus(entry.doc);
		if (status !== 'closed') {
			return {
				ok: false,
				error: `shelter ${entry.code} is not closed (status: ${status ?? 'none'})`
			};
		}
	}

	const shelters = [...byCode.values()]
		.filter((e) => only === null || e.code.toUpperCase() === only.toUpperCase())
		.filter((e) => resolveOperationStatus(e.doc) === 'closed')
		.map((e) => ({
			code: e.code,
			closed_at:
				typeof e.doc.closed_at === 'string' && e.doc.closed_at.trim() ? e.doc.closed_at : null
		}))
		.sort((a, b) => a.code.localeCompare(b.code));
	return { ok: true, shelters };
}

/**
 * FR-30: one audit per shelter in that shelter's DB. `null` when the run changed nothing and
 * failed nothing, so an idempotent re-run (FR-31) writes nothing at all.
 */
export function buildBackfillSummaryAudit(
	target: ClosedShelterTarget,
	run: Pick<ShelterCloseRun, 'checked_out' | 'cancelled' | 'failed'>,
	createdBy: string = BACKFILL_CREATED_BY
): AuditEntry | null {
	if (run.checked_out === 0 && run.cancelled === 0 && run.failed.length === 0) return null;
	const ctx: AuthorContext = { shelterCode: target.code.toUpperCase(), createdBy };
	return createAuditEntry(
		{
			action: 'other',
			target_type: 'shelter',
			target_id: target.code,
			reason: SHELTER_CLOSED_REASON,
			context: {
				...BACKFILL_AUDIT_CONTEXT,
				shelter_closed_at: target.closed_at,
				checked_out: run.checked_out,
				cancelled: run.cancelled,
				failed: run.failed.length
			}
		},
		ctx
	);
}
