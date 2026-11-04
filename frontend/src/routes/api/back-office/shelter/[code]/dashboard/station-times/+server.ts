/**
 * GET /api/back-office/shelter/[code]/dashboard/station-times
 *
 * Returns the per-station service time summary (CR-192): for each (station, channel) the
 * completed `visits`, the mean `avg_duration_sec` and the `open_visits`, optionally limited to
 * a date range via `?from=YYYY-MM-DD&to=YYYY-MM-DD` (CR-170 range; defaults as in the
 * registrations endpoint, Asia/Bangkok).
 *
 * CouchDB view: `station_logs_by_station` (no reduce).
 * Key shape: [YYYY-MM-DD, station, channel, evacuee_id]  →  { action, occurred_at, actor }
 * A `complete` can land after midnight, so the read window is one day wider than the range on
 * both ends; `summarizeStationTimes` pairs the events and counts a visit on the date of its
 * `start`, so only visits that started inside `from..to` are reported (FR-STL-21/22).
 *
 * Security (security-rbac-bestpractices §2 & §3):
 *  - Caller must be authenticated and scoped to this shelter or be a SA.
 *  - Response holds aggregate counts and durations, plus a per-actor rank (CR-192 Amendment 2)
 *    that names staff by `_users.display_name` only — no other user fields (FR-STL-34).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireShelterScopeOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import {
	StationTimesQuerySchema,
	StationTimesPayloadSchema,
	defaultRangeFrom,
	shiftIsoDate
} from '$lib/features/dashboard';
import {
	compareStationActorRank,
	rankStationActors,
	summarizeStationTimes,
	type StationLogEvent
} from '$lib/features/people/server';
import { getDisplayNames } from '$lib/server/user-service';
import { findMasterByCode, type ViewResult } from '$lib/server/shelters.admin';
import { bangkokToday } from '$lib/utils/date';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';

export const prerender = false;

// High-value sentinel: ensures all sub-keys under a date prefix are included when used as endkey.
const SENTINEL = '￰';

type ViewRow = { key: unknown; value: unknown };

/** One view row → a log event; null for a row that does not have the emitted shape. */
function rowToEvent(row: ViewRow): StationLogEvent | null {
	if (!Array.isArray(row.key) || row.key.length < 4) return null;
	const [, station, channel, evacueeId] = row.key as unknown[];
	const value = row.value as { action?: unknown; occurred_at?: unknown; actor?: unknown } | null;
	if (station !== 1 && station !== 2 && station !== 3) return null;
	if (channel !== 'kiosk' && channel !== 'staff') return null;
	if (typeof evacueeId !== 'string') return null;
	if (value?.action !== 'start' && value?.action !== 'complete') return null;
	if (typeof value.occurred_at !== 'string') return null;
	return {
		evacuee_id: evacueeId,
		station,
		channel,
		action: value.action,
		occurred_at: value.occurred_at,
		...(typeof value.actor === 'string' && value.actor ? { actor: value.actor } : {})
	};
}

export const GET: RequestHandler = async ({ params, request, url }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const parsed = StationTimesQuerySchema.safeParse({
			from: url.searchParams.get('from') ?? undefined,
			to: url.searchParams.get('to') ?? undefined
		});
		if (!parsed.success) {
			throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid date range');
		}
		const query = parsed.data;
		const to = query.to ?? bangkokToday();

		const db = `shelter_${code.toLowerCase()}`;

		const deployment = await checkViewDeployment(db, adminRaw);
		if (deployment.state === 'stale') {
			throw new ServiceError(
				'INTERNAL',
				`Dashboard views for ${db} are on an older version (deployed=${deployment.deployedVersion}) than this app build expects — a redeploy of _design/app is pending`
			);
		}

		// Without `from` the view is read from its first key, which also gives the earliest log date.
		const startkey = query.from
			? `&startkey=${encodeURIComponent(JSON.stringify([shiftIsoDate(query.from, -1)]))}`
			: '';
		const viewPath =
			`/${db}/_design/app/_view/station_logs_by_station?reduce=false` +
			startkey +
			`&endkey=${encodeURIComponent(JSON.stringify([shiftIsoDate(to, 1) + SENTINEL, SENTINEL]))}`;

		const res = await adminRaw(viewPath, 'GET');

		if (res.status === 404) {
			throw new ServiceError('INTERNAL', 'Dashboard station_logs_by_station view is not deployed');
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `station_logs_by_station view error (${res.status})`);
		}

		const rows = (res.data as ViewResult).rows ?? [];
		const events = rows.map(rowToEvent).filter((e): e is StationLogEvent => e !== null);

		const firstKey = rows[0]?.key as unknown;
		const earliestRowDate =
			Array.isArray(firstKey) && typeof firstKey[0] === 'string' ? firstKey[0] : undefined;
		const from =
			query.from ??
			defaultRangeFrom((await findMasterByCode(code))?.created_at, earliestRowDate, to);

		const actorRows = rankStationActors(events, { from, to });
		const names = await getDisplayNames(
			actorRows.filter((r) => r.kind === 'staff').map((r) => r.actor_id)
		);
		const actors = actorRows
			.map((r) => ({
				...r,
				display_name:
					r.kind === 'kiosk' ? `ตู้ ${r.actor_id}` : (names.get(r.actor_id) ?? r.actor_id)
			}))
			.sort(compareStationActorRank);

		const payload = StationTimesPayloadSchema.parse({
			shelter_code: code,
			range: { from, to },
			stations: summarizeStationTimes(events, { from, to }),
			actors
		});
		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
