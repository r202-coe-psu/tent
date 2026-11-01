import { resolveOperationStatus } from './schema';

export type ClosedAtSource = 'updated_at' | 'now';

export interface ClosedAtBackfill {
	shelter_code: string;
	closed_at: string;
	source: ClosedAtSource;
}

type RegistryDoc = Record<string, unknown>;

function parseIso(value: unknown): string | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * CR-183 FR-22: pick the legacy closed shelters that still lack `closed_at`
 * and derive the value to stamp. Open and `cancelled` shelters, and shelters
 * that already have a stamp, return `null`, which keeps reruns idempotent.
 */
export function planClosedAtBackfill(doc: RegistryDoc, now: string): ClosedAtBackfill | null {
	if (doc.type !== 'shelter') return null;
	if (resolveOperationStatus(doc) !== 'closed') return null;
	if (typeof doc.closed_at === 'string' ? doc.closed_at.trim() !== '' : doc.closed_at != null)
		return null;
	const fromUpdatedAt = parseIso(doc.updated_at);
	return {
		shelter_code: typeof doc.code === 'string' ? doc.code : String(doc._id ?? ''),
		closed_at: fromUpdatedAt ?? now,
		source: fromUpdatedAt ? 'updated_at' : 'now'
	};
}

/** The doc to PUT: only `closed_at`, `updated_at` and `updated_by` change. */
export function applyClosedAtBackfill(
	doc: RegistryDoc,
	plan: ClosedAtBackfill,
	now: string,
	runId: string
): RegistryDoc {
	return { ...doc, closed_at: plan.closed_at, updated_at: now, updated_by: `migration:${runId}` };
}
