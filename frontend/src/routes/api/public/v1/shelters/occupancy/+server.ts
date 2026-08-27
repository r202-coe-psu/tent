import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';
import { sumOccupancyFromStatusRows } from '$lib/features/public-portal/server';

export const prerender = false;

/**
 * GET /api/public/v1/shelters/occupancy?codes=SH001,SH002
 *
 * Aggregate occupancy count per shelter code — same `occupancy` CouchDB view
 * and status-summing as the back-office dashboard
 * (`/api/back-office/shelter/[code]/dashboard/occupancy`), but unauthenticated
 * and batched: an anonymous booker has no session to scope a single shelter
 * by. Response is aggregate numbers only — no PII, same as the staff route.
 *
 * A shelter with a missing/stale dashboard design (`checkViewDeployment`) or
 * a failed view query maps to `null`, not `0` — the booking form must not
 * read that as "fully vacant".
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'public, max-age=30' });

	const codes = (url.searchParams.get('codes') ?? '')
		.split(',')
		.map((c) => c.trim().toUpperCase())
		.filter(Boolean);

	const occupancy: Record<string, number | null> = {};
	await Promise.all(
		codes.map(async (code) => {
			const db = shelterDbName(code);
			try {
				const deployment = await checkViewDeployment(db, adminRaw);
				if (deployment.state !== 'current') {
					occupancy[code] = null;
					return;
				}
				const res = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');
				if (res.status >= 400) {
					occupancy[code] = null;
					return;
				}
				const rows = (res.data as { rows?: unknown } | null)?.rows;
				occupancy[code] = sumOccupancyFromStatusRows(rows);
			} catch {
				occupancy[code] = null;
			}
		})
	);

	return json({ occupancy });
};
