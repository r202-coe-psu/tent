import { now } from '$lib/db/model';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { createStationLog, resolveKioskStartedAt } from '$lib/features/people/server';

type BulkResult = { id?: string; ok?: boolean; error?: string; reason?: string };

/**
 * Append the Station 1 kiosk `station_log` pair — `start` + `complete` — for each member the
 * kiosk just reported in or registered (CR-192 FR-STL-10/11).
 *
 * `channel` is always `kiosk`, `device_id` comes from the authenticated scanner principal and
 * `created_by` is `kiosk:{device_id}`; none of them are ever read from a request body. Only the
 * `start` time may come from the browser (`startedAtRaw`, the lookup / card-read time) and it is
 * clamped by {@link resolveKioskStartedAt}.
 *
 * Best-effort: a failure is logged and swallowed — the check-in already succeeded.
 */
export async function writeKioskStationLogs(
	shelterCode: string,
	deviceId: string,
	evacueeIds: readonly string[],
	startedAtRaw?: unknown
): Promise<void> {
	if (evacueeIds.length === 0 || !deviceId) return;
	try {
		const completedAt = now();
		const startedAt = resolveKioskStartedAt(startedAtRaw, Date.parse(completedAt));
		const ctx = { shelterCode, createdBy: `kiosk:${deviceId}` };
		const docs = evacueeIds.flatMap((evacuee_id) => {
			const base = {
				evacuee_id,
				station: 1 as const,
				channel: 'kiosk' as const,
				device_id: deviceId
			};
			return [
				createStationLog({ ...base, action: 'start', occurred_at: startedAt }, ctx),
				createStationLog({ ...base, action: 'complete', occurred_at: completedAt }, ctx)
			];
		});
		const results = await adminFetch<BulkResult[]>(`/${shelterDbName(shelterCode)}/_bulk_docs`, {
			method: 'POST',
			body: JSON.stringify({ docs })
		});
		const failed = Array.isArray(results) ? results.filter((r) => r.error) : [];
		if (failed.length > 0) {
			console.warn('[Kiosk station_log] Some station_log docs were rejected', {
				count: failed.length,
				error: failed[0]?.error
			});
		}
	} catch (err) {
		console.warn('[Kiosk station_log] Failed to write station_log; check-in kept', err);
	}
}
