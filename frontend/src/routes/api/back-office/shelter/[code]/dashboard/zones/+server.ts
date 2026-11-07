/**
 * GET /api/back-office/shelter/[code]/dashboard/zones
 *
 * Per-zone, per-status evacuee counts from the `occupancy_by_zone` view (?group=true) for the
 * per-zone occupancy widget (CR-226). Same auth, shelter scope and view-version guard as
 * `dashboard/occupancy`. The response holds aggregate counts only — no PII.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireShelterScopeOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { ZoneOccupancyPayloadSchema } from '$lib/features/dashboard';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';

export const prerender = false;

type ZoneViewRow = { key: [string, string]; value: number };

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const code = params.code;
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const db = `shelter_${code.toLowerCase()}`;

		const deployment = await checkViewDeployment(db, adminRaw);
		if (deployment.state === 'stale') {
			throw new ServiceError(
				'INTERNAL',
				`Dashboard views for ${db} are on an older version (deployed=${deployment.deployedVersion}) than this app build expects — a redeploy of _design/app is pending`
			);
		}

		const res = await adminRaw(`/${db}/_design/app/_view/occupancy_by_zone?group=true`, 'GET');
		if (res.status === 404) {
			throw new ServiceError('INTERNAL', 'Dashboard occupancy_by_zone view is not deployed');
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `CouchDB view error (${res.status})`);
		}

		const rows = (res.data as { rows?: ZoneViewRow[] }).rows ?? [];
		const payload = ZoneOccupancyPayloadSchema.parse({
			shelter_code: code,
			rows: rows.map((r) => ({ zone: r.key[0], status: r.key[1], count: r.value }))
		});
		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
