import type { YieldDraftLine } from '../domain/kitchen-yield-receipt';

/**
 * The receive-stock form survives the detour to "create a new item" in
 * sessionStorage. Per-viewer convenience only: every access is guarded because
 * storage can be blocked or empty, and the form works without it.
 */
const key = (mealServiceId: string) => `kitchen-yield-draft:${mealServiceId}`;

export function saveYieldDraft(mealServiceId: string, lines: readonly YieldDraftLine[]): void {
	try {
		sessionStorage.setItem(key(mealServiceId), JSON.stringify(lines));
	} catch {
		// storage unavailable — the user re-enters the lines
	}
}

export function loadYieldDraft(mealServiceId: string): YieldDraftLine[] | null {
	try {
		const raw = sessionStorage.getItem(key(mealServiceId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const rows = parsed.filter(
			(row): row is YieldDraftLine =>
				!!row &&
				typeof row.key === 'string' &&
				typeof row.item_id === 'string' &&
				typeof row.qty === 'string' &&
				typeof row.storage_point_id === 'string'
		);
		return rows.length > 0 ? rows : null;
	} catch {
		return null;
	}
}

export function clearYieldDraft(mealServiceId: string): void {
	try {
		sessionStorage.removeItem(key(mealServiceId));
	} catch {
		// nothing to clear
	}
}
