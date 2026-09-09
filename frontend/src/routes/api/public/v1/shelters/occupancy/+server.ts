import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';
import { occupancyTripleFromStatusRows } from '$lib/features/public-portal/server';

export const prerender = false;

/**
 * GET /api/public/v1/shelters/occupancy?codes=SH001,SH002
 *
 * Aggregate occupancy triple per shelter code — same `occupancy` CouchDB view
 * as the back-office dashboard, but unauthenticated and batched. Response is
 * aggregate numbers only — no PII.
 *
 * CR-112: `occupancy` = Forecast; additive `present` and `in_zone`. A shelter
 * with a missing/stale dashboard design or failed view query maps to `null`
 * counts — the booking form must not read that as "fully vacant".
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'public, max-age=30' });

	const codes = (url.searchParams.get('codes') ?? '')
		.split(',')
		.map((c) => c.trim().toUpperCase())
		.filter(Boolean);

	const occupancy: Record<string, number | null> = {};
	const present: Record<string, number | null> = {};
	const in_zone: Record<string, number | null> = {};

	await Promise.all(
		codes.map(async (code) => {
			const db = shelterDbName(code);
			try {
				const deployment = await checkViewDeployment(db, adminRaw);
				if (deployment.state !== 'current') {
					occupancy[code] = null;
					present[code] = null;
					in_zone[code] = null;
					return;
				}
				const res = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');
				if (res.status >= 400) {
					occupancy[code] = null;
					present[code] = null;
					in_zone[code] = null;
					return;
				}
				const rows = (res.data as { rows?: unknown } | null)?.rows;
				const triple = occupancyTripleFromStatusRows(rows);
				occupancy[code] = triple.occupancy;
				present[code] = triple.present;
				in_zone[code] = triple.in_zone;
			} catch {
				occupancy[code] = null;
				present[code] = null;
				in_zone[code] = null;
			}
		})
	);

	return json({ occupancy, present, in_zone });
};
