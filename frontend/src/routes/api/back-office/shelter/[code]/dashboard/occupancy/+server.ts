/**
 * GET /api/back-office/shelter/[code]/dashboard/occupancy
 *
 * Returns aggregate occupancy counts (registered / checked_in / checked_out /
 * transferred / total) by querying the `occupancy` CouchDB view with ?group=true.
 *
 * Security (security-rbac-bestpractices §2):
 *  - Caller must be authenticated and scoped to this shelter or be a SA.
 *  - shelterCode is extracted from the URL param — never from the request body.
 *  - View is queried via adminRaw (server-only) — CouchDB credentials never
 *    reach the browser (couchdb-pouchdb-bestpractices §2).
 *  - Response contains ONLY aggregate numbers — no PII (§3).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireShelterScopeOrSA, serviceError, ServiceError } from '$lib/server/couch-admin';
import { rowsToOccupancyPayload, OccupancyPayloadSchema } from '$lib/features/dashboard-occupancy';

export const prerender = false;

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const code = params.code;

		// RBAC guard: SA or staff member of this exact shelter.
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const db = `shelter_${code.toLowerCase()}`;

		// Query the occupancy view with group=true to get per-status counts.
		// All keys: 'registered' | 'checked_in' | 'checked_out' | 'transferred'
		const res = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');

		if (res.status === 404) {
			// Design doc not yet deployed — return empty zeros rather than 500.
			return json(rowsToOccupancyPayload(code, []));
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `CouchDB view error (${res.status})`);
		}

		interface ViewResult {
			rows: { key: string; value: number }[];
		}
		const rows = (res.data as ViewResult).rows ?? [];

		// Map view rows → typed payload; Zod validates output shape.
		const payload = OccupancyPayloadSchema.parse(rowsToOccupancyPayload(code, rows));
		return json(payload);
	} catch (e) {
		return serviceError(e);
	}
};
